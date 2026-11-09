# Blender-ai-geometry-nodes

AI-generated Blender Geometry Nodes.

## How This Project Was Built

> [!IMPORTANT]
> The requirements and overall direction of this project come from me; the implementation was carried out with heavy AI assistance. My actual role was tool design, workflow definition, and validating results — not writing code line by line.
>
> This means:
>
> - The code was shaped by repeated trial and error on real cases and incremental refactoring. I cannot guarantee it covers every edge case.
> - If you hit a problem, feel free to open an issue with the error message and I'll look into it. But I'm not a full-time developer, so fixes may take some time.
> - If you need a production-grade library that keeps evolving, this probably isn't it. But if you want to see how far this AI-driven geometry nodes workflow can go, this project has already gone as far as its author could take it. Feel free to use it as a reference and adapt it.
> - Describing how this was built isn't about disclaiming responsibility — it's so you can judge whether it suits your use case.



## Introduction

Tell the AI what you need (in as much detail as possible). The AI will break your request down into math problems, verify them, then look up node information, and finally build the geometry nodes inside Blender.


[Design Notes](DESIGN.md) — how these tools were designed, and what didn't work

## Skills

- **math** — used for early-stage math verification in Python; some packages need to be installed (see [Python environment](#python-environment))
- **node_information** — the node information tool mentioned earlier; a database containing detailed info about geometry nodes
- **execution** — a tool for building and testing

## Limitations

Only works with **Blender 4.5.0** (the `blender-4.5.0-windows-x64.zip` build from the official site). Different Blender versions may add or update geometry nodes, so some node information changes, which mainly affects the usability of these skills.

There are still some design details that aren't handled well — not bugs, exactly, but small, fiddly things that weren't accounted for one by one, because there are simply too many cases involved. Some of these details you won't discover — you have no way of knowing the AI would do that — until you've run it a good many times.


## Setup

### Automatic install

1. Download the latest version from the Releases page (or clone this repository).

2. In the repository directory, open PowerShell and run install.ps1 — it installs pi, creates a Python 3.13 venv with the pinned packages, downloads Blender 4.5.0, copies the skills/extensions into ~\.pi\agent, and fills in py_environment.json:
```powershell    
powershell -ExecutionPolicy Bypass -File .\install.ps1
```


The script asks for the Blender directory, the venv directory, and the workspace path; the python and blender paths in py_environment.json are filled in automatically.

### Manual install

<details>
<summary>Show manual install steps</summary>

1. Download the latest version from the Releases page (or clone this repository).

2.Download blender from here: https://download.blender.org/release/Blender4.5/blender-4.5.0-windows-x64.zip 

3. This isn't a standalone tool: it requires pi agent, and was purpose-built for that environment.
>Or rather, it's only the frontend that's adapted for pi agent — the backend code is self-contained and runs on its own.

4. Install pi, Python 3.13.14 and the packages below, and download + extract Blender 4.5.0 (the `blender-4.5.0-windows-x64.zip` build).

5. Place all `.ts` files flat into the `extensions` folder.

6. Place the four folders (`_shared`, `execution`, `math`, `node_information`) flat into the `skills` folder.

7. Put `py_environment.json` and `APPEND_SYSTEM.md` in the directory ~\.pi\agent.

8. Fill in the three marked paths in `py_environment.json` (see [Python environment](#python-environment)).

In `py_environment.json`, three paths are marked that need to be changed:

> "exe": "-----Fill in the full path. Backslashes must be doubled. Example: C:\\Users\\you\\Python313\\python.exe-----\\python.exe",

> -----Fill in the full path. Backslashes must be doubled. Example: C:\\Users\\you\\Python313\\python.exe-----(Replace this entire block, from the dashes to the dashes.)

If you installed the packages directly into Python itself, use that Python's path. If you set up a dedicated venv instead (Python on C:, packages in an environment folder on D:), use that environment folder's Python path.
</details>


### Python environment
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

>There's also a minor issue that comes up sometimes: the AI doesn't always use bpy or Blender Data, and instead goes straight to the more low-level blender_run to write its own code. I'm still working out how to fix that. But at the start of each task, you can ask it to use the first two tools more, and only fall back to the last one when necessary.

After one skill finishes its task, the AI will load the next skill by itself; it does not load all of them at once (occasionally it does, but that is rare). Also, sometimes after finishing one skill the AI may fail to load the next one (this happened in my testing, but it is also rare).

## Add-on

[Blender-ai-geometry-nodes-trace](https://github.com/DaTingYeQing/Blender-ai-geometry-nodes-trace) — experimental; optional and does not affect normal operation.

> Note: the repository is not public yet; it is still under testing.

<details>
<summary>Show Tool descriptions</summary>

* These are nothing more than thin wrappers around the tool calls; all the real backend logic lives in the Python files.

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

### hook_skill.ts

Updated the skill prompts and added a new hook skill that automatically tells the AI which skills to load during wf_plan.
</details>
