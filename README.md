# ai-geometry-nodes

AI-generated Blender Geometry Nodes.

## Introduction

Tell the AI what you need (in as much detail as possible). The AI will break your request down into math problems, verify them, then look up node information, and finally build the geometry nodes inside Blender.

## Skills

- **math** — used for early-stage math verification in Python; some packages need to be installed (see [Python environment](#python-environment))
- **node_information** — the node information tool mentioned earlier; a database containing detailed info about geometry nodes
- **execution** — a tool for building and testing

## Limitations

Only works with **Blender 4.5.0** (the `blender-4.5.0-windows-x64.zip` build from the official site). Different Blender versions may add or update geometry nodes, so some node information changes, which mainly affects the usability of these skills.

## Setup

1. In the `py_environment` file, three paths are marked that need to be changed.
2. Place all `.ts` files flat into the **extensions** folder, and place the four folders flat into the **skills** folder.
3. Make sure Python and its dependency packages are installed (see below).

## Python environment

Python **3.13.14**

| Package   | Version |
|-----------|---------|
| pyvista   | 0.49.0  |
| trimesh   | 5.1.0   |
| numpy     | 2.5.3   |
| scipy     | 1.18.1  |
| manifold3d| 3.5.3   |

## Workflow

Just tell the AI: *"Load the math or node_information skill, and help me build something in Blender."*

> I say "or" because some tasks are simple enough that no math verification is needed — the AI can look up the nodes and build directly. Sometimes the AI will load the math skill on its own, but ultimately that is up to you.

After one skill finishes its task, the AI will load the next skill by itself; it does not load all of them at once (occasionally it does, but that is rare). Also, sometimes after finishing one skill the AI may fail to load the next one (this happened in my testing, but it is also rare).

## Tool descriptions

### blender_math.ts

Lets the AI build math nodes quickly. The AI only needs to enter a math expression in this front end, and the background script automatically verifies it (`eval`) and builds the node group (`build`).

### blender_build.ts

Lets the AI operate on the node tree quickly (`add`, `link`, `unlink`, `del`, `set`, `interface`, `add item`). The AI just needs to write small entries in the given format to perform the operations.

### blender_screen.ts

This is the AI's eyes. It lets the AI quickly see which nodes exist in the node tree (**rough mode**), and which socket on a specific node is connected to which other node's socket (**detailed mode**).

### bpy.ts

This is the bridge to the external Python. The AI uses it to export models from inside Blender directly to Python, and with the help of the external packages () it can read the data it wants.

### node_query.ts

Gives the AI static and dynamic information about nodes. From a vague memory, the AI can first find a node's idname (**find mode**), then enter the idname to get the full details of that node (**node full mode**).

### wf_plan.ts

A modular task list. The AI calls this tool after completing the early-stage testing.

### blender.ts

A fixed channel for sending scripts into Blender. When the tools above cannot help the AI, it will write code directly and send it to Blender to get what it wants.

### py_environment.josn

The environment configuration file.

### zone_probe.ts

Specifically designed to help AI work with node trees that contain Simulation Zone nodes, making it easier for it to write its own code and pull data as time advances.
