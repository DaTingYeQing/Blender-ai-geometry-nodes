# -*- coding: utf-8 -*-
"""底座：启动 Blender，负责所有杂活。

- 一次启动、常驻；进程/超时/日志/临时配置都在这里
- 读节点 schema（输入/输出）、写入参数、触发求值
- 每轮求值把原始数据落成 result JSON 文件（run_dir 下）

协议：stdin 逐行 JSON；stdout 中以 "@@FIT@@" 开头的行是响应。
"""

from __future__ import annotations

import json
import logging
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque
from typing import Sequence

from meshkit.env import DEFAULT_BLENDER_EXE, blender_exe

PROTOCOL_PREFIX = "@@FIT@@"

_log = logging.getLogger("fitting.base")


class EngineError(RuntimeError):
    """底座出错：启动失败、请求失败、进程退出等。"""


class EngineTimeout(EngineError):
    """等待响应超时；抛出后底座已被终止，不可继续使用。"""


class BlenderBase:
    """常驻 Blender 会话。生命周期：start → read_schema/evaluate → stop。"""

    def __init__(
        self,
        blend: str,
        *,
        object_name: str,
        modifier_name: str,
        node_name: str,
        input_nodes: Sequence[str] | None = None,
        frame: int | None = None,
        blender_exe: str | None = None,
        run_dir: str | None = None,
        host_path: str | None = None,
        launch_args: Sequence[str] | None = None,
        startup_timeout: float = 180.0,
        eval_timeout: float = 300.0,
    ) -> None:
        self.blend = os.path.abspath(blend) if blend else blend
        self.object_name = object_name
        self.modifier_name = modifier_name
        self.node_name = node_name
        self.input_nodes = [str(name) for name in (input_nodes or [])]
        self.frame = int(frame) if frame is not None else None
        self.blender_exe = blender_exe
        self.run_dir = os.path.abspath(run_dir) if run_dir else None
        self.host_path = host_path or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "host.py"
        )
        # 仅供测试：替换默认 blender argv（仍以 exe 开头）。
        self.launch_args = list(launch_args) if launch_args is not None else None
        self.startup_timeout = float(startup_timeout)
        self.eval_timeout = float(eval_timeout)

        self._proc: subprocess.Popen | None = None
        self._inbox: queue.Queue = queue.Queue()
        self._logs: deque[str] = deque(maxlen=200)
        self._err_logs: deque[str] = deque(maxlen=200)
        self._write_lock = threading.Lock()
        self._seq = 0
        self._ready: dict | None = None
        self._broken = False
        self._config_path: str | None = None
        self._trial_files = 0

    # ------------------------------------------------------------- 生命周期

    def start(self) -> "BlenderBase":
        if self._proc is not None:
            raise EngineError("底座已经启动")

        exe = self.blender_exe or blender_exe()
        if self.launch_args is None:
            if not self.blend or not os.path.isfile(self.blend):
                raise EngineError("找不到 .blend：%r" % (self.blend,))
            if not os.path.isfile(self.host_path):
                raise EngineError("找不到 host.py：%r" % (self.host_path,))

        config_path = self._write_config()
        if self.launch_args is not None:
            cmd = [exe, *self.launch_args]
        else:
            cmd = [exe, "--background", self.blend, "--python", self.host_path]

        env = dict(os.environ)
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env["FIT_HOST_CONFIG"] = config_path
        env["FIT_FITTING_ROOT"] = os.path.dirname(
            os.path.dirname(os.path.abspath(__file__))
        )

        _log.debug("启动底座：%s", cmd)
        cwd = None
        if self.launch_args is None and self.blend:
            cwd = os.path.dirname(self.blend) or None
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                cwd=cwd,
            )
        except OSError as exc:
            self._cleanup_config()
            raise EngineError("无法启动 Blender：%s" % exc) from exc

        self._proc = proc
        threading.Thread(target=self._pump_stdout, args=(proc,), daemon=True).start()
        threading.Thread(target=self._pump_stderr, args=(proc,), daemon=True).start()

        try:
            self._wait_ready(proc)
        except BaseException:
            self.kill()
            raise
        return self

    def stop(self) -> None:
        proc = self._proc
        if proc is None:
            self._cleanup_config()
            return
        try:
            if proc.poll() is None and not self._broken:
                try:
                    self._request("bye", timeout=5.0)
                except EngineError:
                    pass
            try:
                proc.wait(timeout=10.0)
            except subprocess.TimeoutExpired:
                _log.warning("Blender 未按时退出，强制结束")
                proc.terminate()
                try:
                    proc.wait(timeout=5.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
        finally:
            self._close_streams(proc)
            self._proc = None
            self._cleanup_config()

    def kill(self) -> None:
        self._broken = True
        proc = self._proc
        if proc is None:
            self._cleanup_config()
            return
        try:
            if proc.poll() is None:
                proc.kill()
            try:
                proc.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                pass
        finally:
            self._close_streams(proc)
            self._proc = None
            self._cleanup_config()

    def __enter__(self) -> "BlenderBase":
        return self.start()

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()

    # ------------------------------------------------------------- 公开操作

    @property
    def pid(self) -> int | None:
        return self._proc.pid if self._proc is not None else None

    @property
    def alive(self) -> bool:
        proc = self._proc
        return proc is not None and not self._broken and proc.poll() is None

    @property
    def ready(self) -> dict | None:
        return self._ready

    def ping(self) -> dict:
        return self._request("ping", timeout=min(self.eval_timeout, 30.0))

    def read_schema(self) -> dict:
        """目标节点的 {node, inputs, outputs} 描述；多节点时还带 nodes 映射。"""
        return self._request("schema", timeout=self.eval_timeout)

    def read_inputs(self) -> list[dict]:
        return self._request("inputs", timeout=self.eval_timeout).get("inputs", [])

    def evaluate(
        self,
        packed,
        mesh_path: str | None = None,
        tag: str | None = None,
    ) -> dict:
        """写值、求值、导出网格；run_dir 存在时把本轮原始数据落成 result JSON。

        packed 单节点时是 {identifier: 打包值}；多节点时是
        [{node, identifier, value}, ...]。
        """
        if mesh_path is None:
            directory = self.run_dir or tempfile.gettempdir()
            os.makedirs(directory, exist_ok=True)
            name = tag or ("mesh_%04d" % (self._trial_files + 1))
            mesh_path = os.path.join(directory, name + ".ply")
        request_params = packed if isinstance(packed, dict) else list(packed)
        result = self._request(
            "eval",
            timeout=self.eval_timeout,
            params=request_params,
            mesh_path=mesh_path,
        )
        if self.run_dir:
            self._write_result(packed, result, tag)
        return result

    # ------------------------------------------------------------- 协议实现

    def _request(self, op: str, *, timeout: float, **fields) -> dict:
        if self._broken:
            raise EngineError("底座已被终止，请新建会话")
        proc = self._proc
        if proc is None:
            raise EngineError("底座还没启动")
        if proc.poll() is not None:
            raise EngineError(
                "Blender 已退出（exit %s）%s" % (proc.returncode, self._tail())
            )

        with self._write_lock:
            self._seq += 1
            seq = self._seq
            payload = {"id": seq, "op": op}
            payload.update(fields)
            data = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
            try:
                proc.stdin.write(data)
                proc.stdin.flush()
            except (BrokenPipeError, OSError) as exc:
                self._abort()
                raise EngineError("写入 Blender 失败：%s" % exc) from exc

        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._abort()
                raise EngineTimeout(
                    "等待 %s 响应超过 %.1f 秒%s" % (op, timeout, self._tail())
                )
            try:
                message = self._inbox.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                continue

            if message is None:
                self._abort()
                raise EngineError("Blender 进程已退出%s" % self._tail())

            if message.get("id") != seq:
                _log.debug("忽略过期消息 id=%r（期望 %r）", message.get("id"), seq)
                continue

            if not message.get("ok"):
                error = message.get("error") or "未知错误"
                tb = message.get("traceback")
                raise EngineError(error + (("\n" + tb) if tb else ""))

            return message.get("result") or {}

    def _wait_ready(self, proc: subprocess.Popen) -> None:
        deadline = time.monotonic() + self.startup_timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise EngineTimeout(
                    "等待 Blender 就绪超过 %.0f 秒%s"
                    % (self.startup_timeout, self._tail())
                )
            try:
                message = self._inbox.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                continue

            if message is None:
                raise EngineError(
                    "Blender 启动即退出（exit %s）%s"
                    % (proc.poll(), self._tail())
                )

            if message.get("op") != "ready":
                _log.debug("启动阶段忽略消息：%r", message)
                continue

            if not message.get("ok", True):
                tb = message.get("traceback")
                raise EngineError(
                    "Blender 内底座初始化失败：%s%s"
                    % (message.get("error") or "未知错误", ("\n" + tb) if tb else "")
                )

            self._ready = message.get("result") or {}
            _log.debug("底座就绪：%r", self._ready)
            return

    # ------------------------------------------------------------- 杂活

    def _write_config(self) -> str:
        config = {
            "object": self.object_name,
            "modifier": self.modifier_name,
            "node": self.node_name,
        }
        if self.input_nodes:
            config["input_nodes"] = list(self.input_nodes)
        if self.frame is not None:
            config["frame"] = self.frame
        fd, path = tempfile.mkstemp(prefix="fit_host_", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(config, handle, ensure_ascii=False)
        except BaseException:
            os.unlink(path)
            raise
        self._config_path = path
        return path

    def _write_result(self, params, result, tag):
        self._trial_files += 1
        name = tag or ("trial_%04d" % self._trial_files)
        path = os.path.join(self.run_dir, name + ".json")
        os.makedirs(self.run_dir, exist_ok=True)
        payload = {
            "tag": name,
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "params": params,
            "result": result,
        }
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)

    def _cleanup_config(self) -> None:
        path, self._config_path = self._config_path, None
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass

    def _abort(self) -> None:
        if not self._broken:
            _log.warning("底座状态失步，终止 Blender")
        self.kill()

    def _close_streams(self, proc: subprocess.Popen) -> None:
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            try:
                if stream is not None:
                    stream.close()
            except OSError:
                pass

    def _tail(self, lines: int = 10) -> str:
        parts = []
        out = [line for line in list(self._logs)[-lines:] if line.strip()]
        err = [line for line in list(self._err_logs)[-lines:] if line.strip()]
        if out:
            parts.append("stdout:\n" + "\n".join(out))
        if err:
            parts.append("stderr:\n" + "\n".join(err))
        return ("\n" + "\n".join(parts)) if parts else ""

    def _pump_stdout(self, proc: subprocess.Popen) -> None:
        stream = proc.stdout
        try:
            while True:
                raw = stream.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                if line.startswith(PROTOCOL_PREFIX):
                    payload = line[len(PROTOCOL_PREFIX):].strip()
                    if not payload:
                        continue
                    try:
                        message = json.loads(payload)
                    except json.JSONDecodeError:
                        self._logs.append(line)
                        continue
                    self._inbox.put(message)
                else:
                    self._logs.append(line)
        except (ValueError, OSError):
            pass
        finally:
            self._inbox.put(None)

    def _pump_stderr(self, proc: subprocess.Popen) -> None:
        stream = proc.stderr
        try:
            while True:
                raw = stream.readline()
                if not raw:
                    break
                self._err_logs.append(
                    raw.decode("utf-8", errors="replace").rstrip("\r\n")
                )
        except (ValueError, OSError):
            pass


def main(argv: Sequence[str] | None = None) -> int:
    """命令行自检：python -m fitting.base --check"""
    import argparse

    parser = argparse.ArgumentParser(prog="python -m fitting.base")
    parser.add_argument("--check", action="store_true", help="打印 Blender 路径与版本")
    args = parser.parse_args(argv)

    exe = blender_exe()
    print("blender.exe : %s" % exe)
    if not os.path.isfile(exe):
        print("警告        : 文件不存在")
        return 1
    if args.check:
        proc = subprocess.run([exe, "--version"], capture_output=True, timeout=120)
        text = (proc.stdout or b"").decode("utf-8", errors="replace")
        first = text.strip().splitlines()[0] if text.strip() else "(无法获取)"
        print("版本        : %s" % first)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
