"""所有一次数据的路径注册。
从真实 bake 数据中自动发现并注册，保证 recipe 可引用所有已知路径。
"""
from ._utils import walk_path as _walk

DIGEST = {
    "mesh_num_vertices":          "烘焙项/0/data/mesh/num_vertices",
    "mesh_num_edges":             "烘焙项/0/data/mesh/num_edges",
    "mesh_num_polygons":          "烘焙项/0/data/mesh/num_polygons",
    "mesh_num_corners":           "烘焙项/0/data/mesh/num_corners",
    "pointcloud_num_points":      "烘焙项/0/data/pointcloud/num_points",
    "instances_num":              "烘焙项/0/data/num_instances",
    # curves
    "curves_num_points":          "烘焙项/0/data/curves/num_points",
    "curves_num_curves":          "烘焙项/0/data/curves/num_curves",
    "references_mesh_num_vertices": "烘焙项/0/data/references/0/mesh/num_vertices",
    "references_mesh_num_edges":    "烘焙项/0/data/references/0/mesh/num_edges",
    "references_mesh_num_polygons": "烘焙项/0/data/references/0/mesh/num_polygons",
    "references_mesh_num_corners":  "烘焙项/0/data/references/0/mesh/num_corners",
}

ATTR = {
    # mesh
    "mesh_position":          "烘焙项/0/data/mesh/attributes[position]/value",
    "mesh_poly_offsets":      "烘焙项/0/data/mesh/poly_offsets",
    "mesh_sharp_face":        "烘焙项/0/data/mesh/attributes[sharp_face]/value",
    "mesh_materials":         "烘焙项/0/data/mesh/materials",
    "mesh_.corner_edge":      "烘焙项/0/data/mesh/attributes[.corner_edge]/value",
    "mesh_.corner_vert":      "烘焙项/0/data/mesh/attributes[.corner_vert]/value",
    "mesh_.edge_verts":       "烘焙项/0/data/mesh/attributes[.edge_verts]/value",
    "mesh_.select_vert":      "烘焙项/0/data/mesh/attributes[.select_vert]/value",
    "mesh_.select_edge":      "烘焙项/0/data/mesh/attributes[.select_edge]/value",
    "mesh_.select_poly":      "烘焙项/0/data/mesh/attributes[.select_poly]/value",
    "mesh_UV贴图":              "烘焙项/0/data/mesh/attributes[UV贴图]/value",
    "mesh_UVMap":              "烘焙项/0/data/mesh/attributes[UVMap]/value",
    "mesh_material_index":     "烘焙项/0/data/mesh/attributes[material_index]/value",
    # pointcloud
    "pointcloud_position":    "烘焙项/0/data/pointcloud/attributes[position]/value",
    "pointcloud_radius":      "烘焙项/0/data/pointcloud/attributes[radius]/value",
    "pointcloud_materials":   "烘焙项/0/data/pointcloud/materials",
    # instances
    "instance_transform":     "烘焙项/0/data/实例属性[instance_transform]/value",
    "instance_id":            "烘焙项/0/data/实例属性[id]/value",
    "instance_reference_index": "烘焙项/0/data/实例属性[.reference_index]/value",
    # curves
    "curves_position":         "烘焙项/0/data/curves/attributes[position]/value",
    "curves_radius":           "烘焙项/0/data/curves/attributes[radius]/value",
    "curves_tilt":             "烘焙项/0/data/curves/attributes[tilt]/value",
    "curves_cyclic":           "烘焙项/0/data/curves/attributes[cyclic]/value",
    "curves_resolution":       "烘焙项/0/data/curves/attributes[resolution]/value",
    # references (模板几何)
    "references_mesh_position":    "烘焙项/0/data/references/0/mesh/attributes[position]/value",
    "references_mesh_poly_offsets": "烘焙项/0/data/references/0/mesh/poly_offsets",
    "references_mesh_sharp_face":   "烘焙项/0/data/references/0/mesh/attributes[sharp_face]/value",
    "references_mesh_materials":    "烘焙项/0/data/references/0/mesh/materials",
    "references_mesh_.corner_edge": "烘焙项/0/data/references/0/mesh/attributes[.corner_edge]/value",
    "references_mesh_.corner_vert": "烘焙项/0/data/references/0/mesh/attributes[.corner_vert]/value",
    "references_mesh_.edge_verts":  "烘焙项/0/data/references/0/mesh/attributes[.edge_verts]/value",
    "references_mesh_.select_vert": "烘焙项/0/data/references/0/mesh/attributes[.select_vert]/value",
    "references_mesh_.select_edge": "烘焙项/0/data/references/0/mesh/attributes[.select_edge]/value",
    "references_mesh_.select_poly": "烘焙项/0/data/references/0/mesh/attributes[.select_poly]/value",
    "references_mesh_UV贴图":        "烘焙项/0/data/references/0/mesh/attributes[UV贴图]/value",
}

def read(transfer_json, path_key):
    """按 key 从 transfer JSON 中读取数据。"""
    path = DIGEST.get(path_key) or ATTR.get(path_key)
    if path is None:
        return None
    return _walk(transfer_json, path)