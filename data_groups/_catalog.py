"""数据目录手册 — 静态描述所有可读取的数据路径。
AI 通过 search_catalog() 翻阅这本手册，不需要记路径名。
"""
import json

# ==================== 目录条目 ====================
# type: 数据类型 + 形状
# desc: 中文描述
# family: 所属几何族 (mesh/pointcloud/curves/instances)
# tags: 搜索关键词

CATALOG = [
    # ========== mesh ==========
    {
        "key": "mesh_num_vertices",
        "type": "int",
        "desc": "网格顶点总数",
        "family": "mesh",
        "tags": ["网格", "顶点", "数量", "count", "vertex"],
    },
    {
        "key": "mesh_num_edges",
        "type": "int",
        "desc": "网格边总数",
        "family": "mesh",
        "tags": ["网格", "边", "数量", "edge"],
    },
    {
        "key": "mesh_num_polygons",
        "type": "int",
        "desc": "网格面片总数",
        "family": "mesh",
        "tags": ["网格", "面", "多边形", "数量", "polygon", "face"],
    },
    {
        "key": "mesh_num_corners",
        "type": "int",
        "desc": "网格角点总数",
        "family": "mesh",
        "tags": ["网格", "角点", "corner"],
    },
    {
        "key": "mesh_poly_offsets",
        "type": "N×1 int",
        "desc": "网格面片偏移数组，描述每个面在 corner 数组中的起止位置",
        "family": "mesh",
        "tags": ["网格", "面", "偏移", "poly", "offsets", "拓扑"],
    },
    {
        "key": "mesh_materials",
        "type": "list",
        "desc": "网格材质列表",
        "family": "mesh",
        "tags": ["网格", "材质", "material"],
    },
    {
        "key": "mesh_position",
        "type": "N×3 float",
        "desc": "网格顶点坐标，每行一个顶点 (x, y, z)",
        "family": "mesh",
        "tags": ["网格", "顶点", "位置", "坐标", "position", "xyz"],
    },
    {
        "key": "mesh_sharp_face",
        "type": "N×1 bool",
        "desc": "网格面片尖锐标记，True 表示该面为锐边",
        "family": "mesh",
        "tags": ["网格", "面", "尖锐", "sharp", "标记"],
    },
    {
        "key": "mesh_material_index",
        "type": "N×1 int",
        "desc": "网格每个面片的材质索引",
        "family": "mesh",
        "tags": ["网格", "材质", "索引", "material", "index"],
    },
    {
        "key": "mesh_UV贴图",
        "type": "N×2 float",
        "desc": "网格 UV 贴图坐标，每行 (u, v)",
        "family": "mesh",
        "tags": ["网格", "UV", "贴图", "纹理", "坐标"],
    },
    {
        "key": "mesh_UVMap",
        "type": "N×2 float",
        "desc": "网格 UV 贴图坐标（英文名），每行 (u, v)",
        "family": "mesh",
        "tags": ["网格", "UV", "贴图", "纹理", "坐标", "UVMap"],
    },
    {
        "key": "mesh_.corner_edge",
        "type": "N×1 int",
        "desc": "网格角点对应的边索引（内部拓扑）",
        "family": "mesh",
        "tags": ["网格", "角点", "边", "拓扑", "corner", "edge", "内部"],
    },
    {
        "key": "mesh_.edge_verts",
        "type": "N×2 int",
        "desc": "网格每条边的两个顶点索引（内部拓扑）",
        "family": "mesh",
        "tags": ["网格", "边", "顶点", "拓扑", "edge", "vert", "内部"],
    },
    {
        "key": "mesh_.corner_vert",
        "type": "N×1 int",
        "desc": "网格角点对应的顶点索引（内部拓扑）",
        "family": "mesh",
        "tags": ["网格", "角点", "顶点", "拓扑", "corner", "vert", "内部"],
    },
    {
        "key": "mesh_.select_vert",
        "type": "N×1 bool",
        "desc": "网格顶点选择状态（内部标记）",
        "family": "mesh",
        "tags": ["网格", "顶点", "选择", "select", "内部"],
    },
    {
        "key": "mesh_.select_edge",
        "type": "N×1 bool",
        "desc": "网格边选择状态（内部标记）",
        "family": "mesh",
        "tags": ["网格", "边", "选择", "select", "内部"],
    },
    {
        "key": "mesh_.select_poly",
        "type": "N×1 bool",
        "desc": "网格面选择状态（内部标记）",
        "family": "mesh",
        "tags": ["网格", "面", "选择", "select", "内部"],
    },
    # ========== curves ==========
    {
        "key": "curves_num_points",
        "type": "int",
        "desc": "曲线控制点总数",
        "family": "curves",
        "tags": ["曲线", "控制点", "数量", "point"],
    },
    {
        "key": "curves_num_curves",
        "type": "int",
        "desc": "曲线条数",
        "family": "curves",
        "tags": ["曲线", "条数", "数量", "curve"],
    },
    {
        "key": "curves_position",
        "type": "N×3 float",
        "desc": "曲线控制点坐标，每行一个点 (x, y, z)",
        "family": "curves",
        "tags": ["曲线", "控制点", "位置", "坐标", "position"],
    },
    {
        "key": "curves_radius",
        "type": "N×1 float",
        "desc": "曲线每个控制点的半径值",
        "family": "curves",
        "tags": ["曲线", "半径", "粗细", "radius", "thickness"],
    },
    {
        "key": "curves_tilt",
        "type": "N×1 float",
        "desc": "曲线每个控制点的倾斜角度",
        "family": "curves",
        "tags": ["曲线", "倾斜", "角度", "tilt"],
    },
    {
        "key": "curves_cyclic",
        "type": "N×1 bool",
        "desc": "曲线是否闭合（循环）",
        "family": "curves",
        "tags": ["曲线", "闭合", "循环", "cyclic"],
    },
    {
        "key": "curves_resolution",
        "type": "N×1 int",
        "desc": "曲线每条的分辨率（细分段数）",
        "family": "curves",
        "tags": ["曲线", "分辨率", "细分", "resolution"],
    },
    # ========== pointcloud ==========
    {
        "key": "pointcloud_num_points",
        "type": "int",
        "desc": "点云中点总数",
        "family": "pointcloud",
        "tags": ["点云", "点", "数量", "point"],
    },
    {
        "key": "pointcloud_materials",
        "type": "list",
        "desc": "点云材质列表",
        "family": "pointcloud",
        "tags": ["点云", "材质", "material"],
    },
    {
        "key": "pointcloud_position",
        "type": "N×3 float",
        "desc": "点云点坐标，每行一个点 (x, y, z)",
        "family": "pointcloud",
        "tags": ["点云", "点", "位置", "坐标", "position"],
    },
    {
        "key": "pointcloud_radius",
        "type": "N×1 float",
        "desc": "点云每个点的半径值",
        "family": "pointcloud",
        "tags": ["点云", "半径", "大小", "radius", "size"],
    },
    # ========== instances ==========
    {
        "key": "instances_num",
        "type": "int",
        "desc": "实例总数",
        "family": "instances",
        "tags": ["实例", "数量", "count", "instance"],
    },
    {
        "key": "instance_transform",
        "type": "N×16 float",
        "desc": "实例变换矩阵，列主序 4×4，每个实例 16 个 float",
        "family": "instances",
        "tags": ["实例", "变换", "矩阵", "位移", "旋转", "缩放",
                 "transform", "matrix", "translation", "rotation", "scale"],
    },
    {
        "key": "instance_id",
        "type": "N×1 int",
        "desc": "实例 ID 列表",
        "family": "instances",
        "tags": ["实例", "ID", "编号", "id", "index"],
    },
    {
        "key": "instance_reference_index",
        "type": "N×1 int",
        "desc": "实例引用模板的索引（内部标记）",
        "family": "instances",
        "tags": ["实例", "引用", "模板", "reference", "index", "内部"],
    },
    # ========== references（模板几何，实例的内部引用网格）==========
    {
        "key": "references_mesh_num_vertices",
        "type": "int",
        "desc": "模板几何顶点总数",
        "family": "mesh",
        "tags": ["模板", "几何", "顶点", "数量", "reference"],
    },
    {
        "key": "references_mesh_num_edges",
        "type": "int",
        "desc": "模板几何边总数",
        "family": "mesh",
        "tags": ["模板", "几何", "边", "数量", "reference"],
    },
    {
        "key": "references_mesh_num_polygons",
        "type": "int",
        "desc": "模板几何面片总数",
        "family": "mesh",
        "tags": ["模板", "几何", "面", "数量", "reference"],
    },
    {
        "key": "references_mesh_num_corners",
        "type": "int",
        "desc": "模板几何角点总数",
        "family": "mesh",
        "tags": ["模板", "几何", "角点", "corner", "reference"],
    },
    {
        "key": "references_mesh_position",
        "type": "N×3 float",
        "desc": "模板几何顶点坐标，每行一个顶点 (x, y, z)",
        "family": "mesh",
        "tags": ["模板", "几何", "顶点", "位置", "position", "reference"],
    },
    {
        "key": "references_mesh_poly_offsets",
        "type": "N×1 int",
        "desc": "模板几何面片偏移数组",
        "family": "mesh",
        "tags": ["模板", "几何", "面", "偏移", "poly", "offsets", "reference"],
    },
    {
        "key": "references_mesh_materials",
        "type": "list",
        "desc": "模板几何材质列表",
        "family": "mesh",
        "tags": ["模板", "几何", "材质", "material", "reference"],
    },
    {
        "key": "references_mesh_sharp_face",
        "type": "N×1 bool",
        "desc": "模板几何面片尖锐标记",
        "family": "mesh",
        "tags": ["模板", "几何", "面", "尖锐", "sharp", "reference"],
    },
    {
        "key": "references_mesh_.corner_edge",
        "type": "N×1 int",
        "desc": "模板几何角点对应的边索引",
        "family": "mesh",
        "tags": ["模板", "几何", "角点", "边", "corner", "edge", "reference"],
    },
    {
        "key": "references_mesh_.corner_vert",
        "type": "N×1 int",
        "desc": "模板几何角点对应的顶点索引",
        "family": "mesh",
        "tags": ["模板", "几何", "角点", "顶点", "corner", "vert", "reference"],
    },
    {
        "key": "references_mesh_.edge_verts",
        "type": "N×2 int",
        "desc": "模板几何每条边的两个顶点索引",
        "family": "mesh",
        "tags": ["模板", "几何", "边", "顶点", "edge", "vert", "reference"],
    },
    {
        "key": "references_mesh_.select_vert",
        "type": "N×1 bool",
        "desc": "模板几何顶点选择状态",
        "family": "mesh",
        "tags": ["模板", "几何", "顶点", "选择", "select", "reference"],
    },
    {
        "key": "references_mesh_.select_edge",
        "type": "N×1 bool",
        "desc": "模板几何边选择状态",
        "family": "mesh",
        "tags": ["模板", "几何", "边", "选择", "select", "reference"],
    },
    {
        "key": "references_mesh_.select_poly",
        "type": "N×1 bool",
        "desc": "模板几何面选择状态",
        "family": "mesh",
        "tags": ["模板", "几何", "面", "选择", "select", "reference"],
    },
    {
        "key": "references_mesh_UV贴图",
        "type": "N×2 float",
        "desc": "模板几何 UV 贴图坐标，每行 (u, v)",
        "family": "mesh",
        "tags": ["模板", "几何", "UV", "贴图", "纹理", "reference"],
    },
    # ========== 非几何数值（烘焙节点的输出） ==========
    # 这些是烘焙节点输出的非几何数值，名称由用户自定义，无法预注册路径。
    # AI 可通过 search_catalog("数值") 查到这些类型，recipe 中需用实际名称。
    {
        "key": "__value_float__",
        "type": "float",
        "desc": "烘焙节点输出的单精度浮点数，名称由用户自定义",
        "family": "value",
        "tags": ["数值", "浮点", "float", "单精度"],
    },
    {
        "key": "__value_int__",
        "type": "int",
        "desc": "烘焙节点输出的整数，名称由用户自定义",
        "family": "value",
        "tags": ["数值", "整数", "int", "integer"],
    },
    {
        "key": "__value_bool__",
        "type": "bool",
        "desc": "烘焙节点输出的布尔值，名称由用户自定义",
        "family": "value",
        "tags": ["数值", "布尔", "bool", "boolean"],
    },
    {
        "key": "__value_vector__",
        "type": "3×float",
        "desc": "烘焙节点输出的三维向量 (x, y, z)，名称由用户自定义",
        "family": "value",
        "tags": ["数值", "向量", "vector", "三维"],
    },
    {
        "key": "__value_color__",
        "type": "4×float",
        "desc": "烘焙节点输出的颜色 (r, g, b, a)，名称由用户自定义",
        "family": "value",
        "tags": ["数值", "颜色", "color", "RGBA"],
    },
    {
        "key": "__value_rotation__",
        "type": "4×float",
        "desc": "烘焙节点输出的旋转四元数 (w, x, y, z)，名称由用户自定义",
        "family": "value",
        "tags": ["数值", "旋转", "rotation", "四元数", "quaternion"],
    },
    {
        "key": "__value_matrix__",
        "type": "16×float",
        "desc": "烘焙节点输出的 4×4 矩阵，名称由用户自定义",
        "family": "value",
        "tags": ["数值", "矩阵", "matrix", "4x4"],
    },
    {
        "key": "__value_string__",
        "type": "str",
        "desc": "烘焙节点输出的字符串，名称由用户自定义",
        "family": "value",
        "tags": ["数值", "字符串", "string", "str"],
    },
]


def search_catalog(keyword=""):
    """按关键词搜索目录，返回匹配的所有条目。
    
    AI 用这个函数翻手册，不需要记住路径名。
    
    示例:
        search_catalog("position")  → 所有 position 相关条目
        search_catalog("半径")      → radius 相关条目
        search_catalog("")          → 返回全部条目
    """
    if not keyword:
        return CATALOG
    kw = keyword.lower()
    results = []
    for entry in CATALOG:
        if kw in entry["key"].lower():
            results.append(entry)
            continue
        if kw in entry["desc"].lower():
            results.append(entry)
            continue
        for tag in entry["tags"]:
            if kw in tag.lower():
                results.append(entry)
                break
    return results


def list_families():
    """按几何族分组列出所有 key。"""
    groups = {}
    for entry in CATALOG:
        groups.setdefault(entry["family"], []).append(entry["key"])
    return groups


def to_json():
    """导出为 JSON 字符串（供 AI 读取）。"""
    return json.dumps(CATALOG, ensure_ascii=False, indent=2)