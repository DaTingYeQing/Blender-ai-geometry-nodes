"""diff 模块：对比 room 输出的 baseline/modified 数据，只保留变化的条目。"""
from ._utils import almost_eq


def _diff_value(baseline, modified):
    """比较两个值，返回是否变化。"""
    if baseline is None and modified is None:
        return False
    if baseline is None or modified is None:
        return True
    if isinstance(baseline, dict) and isinstance(modified, dict):
        return _diff_dict(baseline, modified)
    if isinstance(baseline, list) and isinstance(modified, list):
        return not _lists_equal(baseline, modified)
    return not almost_eq(baseline, modified)


def _lists_equal(a, b):
    """递归比较两个列表是否相等。"""
    if len(a) != len(b):
        return False
    return all(almost_eq(x, y) for x, y in zip(a, b))


def _diff_dict(baseline, modified):
    """比较两个 dict，返回是否有任何 key 变化。"""
    all_keys = set(baseline.keys()) | set(modified.keys())
    for k in all_keys:
        if k in ("baseline", "modified"):
            continue
        bv = baseline.get(k)
        mv = modified.get(k)
        if _diff_value(bv, mv):
            return True
    return False


def _keep_only_changed(room_result):
    """递归遍历 room 结果，只保留有变化的条目。"""
    if not isinstance(room_result, dict):
        return room_result

    # 如果这个 dict 有 baseline 和 modified 字段 → 是叶子对比项
    if "baseline" in room_result and "modified" in room_result:
        if _diff_value(room_result["baseline"], room_result["modified"]):
            return room_result
        return None  # 没变化，丢弃

    # 普通 dict → 递归
    result = {}
    for k, v in room_result.items():
        filtered = _keep_only_changed(v)
        if filtered is not None:
            result[k] = filtered
    return result if result else None


def diff(room_result):
    """对比 room 输出的 baseline/modified 数据，只保留变化的条目。

    输入: room.run() 的输出
    输出: 只保留有变化的条目，格式与 room 输出一致
    """
    result = _keep_only_changed(room_result)
    return result if result else {}