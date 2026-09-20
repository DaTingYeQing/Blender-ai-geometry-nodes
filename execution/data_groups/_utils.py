"""共享工具函数：路径取值、统计公式、采样等"""

# ==================== 路径取值 ====================

def walk_path(obj, path):
    """按 "烘焙项/0/data/mesh/attributes[position]/value" 路径取值。"""
    parts = path.split("/")
    current = obj
    for part in parts:
        if current is None:
            return None
        if part.endswith("]"):
            bracket = part.index("[")
            key = part[:bracket]
            inner = part[bracket+1:-1]
            if isinstance(current, dict):
                lst = current.get(key)
            elif isinstance(current, list):
                lst = current
            else:
                return None
            if isinstance(lst, list):
                found = None
                for item in lst:
                    if isinstance(item, dict) and item.get("name") == inner:
                        found = item
                        break
                current = found
            else:
                current = None
        elif isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list):
            try:
                idx = int(part)
                current = current[idx] if 0 <= idx < len(current) else None
            except (ValueError, IndexError):
                current = None
        else:
            return None
    return current


# ==================== 统计公式 ====================

def calc_stats(values):
    """算统计：min/max/mean/std/有NaN/全零/有异常值(3σ)。"""
    import math
    if not isinstance(values, list) or len(values) == 0:
        return None
    is_vec = isinstance(values[0], (list, tuple))
    result = {}
    if is_vec:
        dim = len(values[0])
        comps = [[v[i] for v in values] for i in range(dim)]
        result["min"] = [min(c) for c in comps]
        result["max"] = [max(c) for c in comps]
        result["mean"] = [sum(c) / len(c) for c in comps]
        result["有NaN"] = any(math.isnan(v) for row in values for v in row)
        result["全零"] = all(abs(v) < 1e-6 for row in values for v in row)
        stds = [math.sqrt(sum((x - sum(c) / len(c)) ** 2 for x in c) / len(c)) for c in comps]
        result["有异常值"] = any(
            any(abs(v[i] - result["mean"][i]) > 3 * stds[i] for i in range(dim))
            for v in values
        ) if all(s > 1e-8 for s in stds) else False
        for k in ("min", "max", "mean"):
            result[k] = [round(x, 6) for x in result[k]]
    else:
        result["min"] = min(values)
        result["max"] = max(values)
        result["mean"] = sum(values) / len(values)
        result["有NaN"] = any(math.isnan(v) for v in values)
        result["全零"] = all(abs(v) < 1e-6 for v in values)
        m = result["mean"]
        var = sum((x - m) ** 2 for x in values) / len(values)
        std = math.sqrt(var)
        result["有异常值"] = any(abs(v - m) > 3 * std for v in values) if std > 1e-8 else False
        for k in ("min", "max", "mean"):
            result[k] = round(result[k], 6)
    return result


def bbox(position_data):
    """从 position 算包围盒。"""
    stats = calc_stats(position_data)
    if stats is None:
        return None
    return {"min": stats["min"], "max": stats["max"]}


def sample_uniform(values, n=20):
    """均匀采样，首尾覆盖。"""
    if not isinstance(values, list) or len(values) == 0:
        return []
    if len(values) <= n:
        return values
    step = (len(values) - 1) / (n - 1) if n > 1 else 1
    return [values[round(i * step)] for i in range(n)]


def filter_internal(attrs):
    """过滤内部属性（.xxx 开头）。"""
    return [a for a in attrs if not a.get("name", "").startswith(".")]


def almost_eq(a, b, eps=1e-6):
    """浮点容差比较。"""
    if isinstance(a, float) and isinstance(b, float):
        return abs(a - b) <= eps
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        return all(almost_eq(x, y, eps) for x, y in zip(a, b))
    return a == b


# ==================== 矩阵分解 ====================

def transform_point(matrix, point):
    """用 4x4 列主序矩阵变换一个点 (x, y, z)。
    处理旋转 + 缩放 + 位移（齐次 w=1）。返回 [x', y', z']。"""
    x, y, z = point[0], point[1], point[2]
    return [
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    ]


def decompose_matrix_euler(matrix):
    """从 4x4 列主序矩阵 [16个float] 提取位移、缩放、欧拉角（XYZ，单位度）。
    返回 {"translation": [tx,ty,tz], "scale": [sx,sy,sz], "euler": [rx,ry,rz]}。"""
    import math
    # 位移
    translation = [matrix[12], matrix[13], matrix[14]]
    # 列向量（列主序：第 c 列第 r 行 = m[c*4+r]）
    col0 = [matrix[0], matrix[1], matrix[2]]
    col1 = [matrix[4], matrix[5], matrix[6]]
    col2 = [matrix[8], matrix[9], matrix[10]]
    # 缩放 = 列长度
    def vlen(v):
        return math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    sx, sy, sz = vlen(col0), vlen(col1), vlen(col2)
    scale = [sx, sy, sz]
    # 归一化列（去掉缩放，只留旋转）
    r0 = [c / sx for c in col0] if sx > 1e-8 else [1.0, 0.0, 0.0]
    r1 = [c / sy for c in col1] if sy > 1e-8 else [0.0, 1.0, 0.0]
    r2 = [c / sz for c in col2] if sz > 1e-8 else [0.0, 0.0, 1.0]
    # XYZ 欧拉提取（Blender 约定，旋转矩阵行主序）
    # R[0][0]=col0[0], R[0][1]=col1[0], R[0][2]=col2[0]
    # R[1][2]=col2[1], R[2][2]=col2[2]
    y = math.asin(max(-1.0, min(1.0, r2[0])))
    x = math.atan2(-r2[1], r2[2])
    z = math.atan2(-r1[0], r0[0])
    euler = [math.degrees(x), math.degrees(y), math.degrees(z)]
    return {"translation": translation, "scale": scale, "euler": euler}


def decompose_matrix(matrix):
    """从 4x4 列主序矩阵列表 [16个float] 提取位移、缩放、旋转。
    输入：一个矩阵 (16个float) 或矩阵列表 (Nx16)。
    输出：{translation, scale, rotation} 或列表。
    """
    import math
    if not isinstance(matrix, list) or len(matrix) == 0:
        return None
    # 单个矩阵
    if len(matrix) == 16 and not isinstance(matrix[0], list):
        return _decompose_one(matrix)
    # 多个矩阵
    return [_decompose_one(m) for m in matrix]


def _decompose_one(m):
    """分解单个 4x4 列主序矩阵。"""
    import math
    # 列主序：m[col*4 + row]
    # 位移
    trans = [round(m[12], 6), round(m[13], 6), round(m[14], 6)]
    # 3x3 部分（列向量）
    col0 = [m[0], m[1], m[2]]
    col1 = [m[4], m[5], m[6]]
    col2 = [m[8], m[9], m[10]]
    # 缩放 = 列向量长度
    def vec_len(v):
        return math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)
    sx = vec_len(col0)
    sy = vec_len(col1)
    sz = vec_len(col2)
    scale = [round(sx, 6), round(sy, 6), round(sz, 6)]
    # 旋转矩阵（归一化后的 3x3）
    # 这里不分解欧拉角，只返回归一化矩阵，避免万向锁
    rot = []
    if sx > 1e-8:
        rot.extend([round(c / sx, 6) for c in col0])
    else:
        rot.extend([1.0 if i == 0 else 0.0 for i in range(3)])
    if sy > 1e-8:
        rot.extend([round(c / sy, 6) for c in col1])
    else:
        rot.extend([0.0, 1.0, 0.0])
    if sz > 1e-8:
        rot.extend([round(c / sz, 6) for c in col2])
    else:
        rot.extend([0.0, 0.0, 1.0])
    return {"translation": trans, "scale": scale, "rotation": rot}