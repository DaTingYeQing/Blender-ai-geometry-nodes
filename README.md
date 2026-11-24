# Blender-ai-geometry-nodes

* AI-generated Blender Geometry Nodes.

# How This Project Was Built

> [!IMPORTANT]
> The requirements and overall direction of this project come from me; the implementation was carried out with heavy AI assistance. My actual role was tool design, workflow definition, and validating results — not writing code line by line.
>
> This means:
>
> - The code was shaped by repeated trial and error on real cases and incremental refactoring. I cannot guarantee it covers every edge case.
> - If you hit a problem, feel free to open an issue with the error message and I'll look into it. But I'm not a full-time developer, so fixes may take some time.
> - If you need a production-grade library that keeps evolving, this probably isn't it. But if you want to see how far this AI-driven geometry nodes workflow can go, this project has already gone as far as its author could take it. Feel free to use it as a reference and adapt it.
> - Describing how this was built isn't about disclaiming responsibility — it's so you can judge whether it suits your use case.



# Introduction

* Tell the AI what you need (in as much detail as possible). The AI will break your request down into math problems, verify them, then look up node information, and finally build the geometry nodes inside Blender.

* Only works with **Blender 4.5.0** 
>Different Blender versions may add or update geometry nodes, so some node information changes, which mainly affects the usability of these skills.

* It is built on top of the Pi Agent.

* There are still some design details that aren't handled well — not bugs, exactly, but small, fiddly things that weren't accounted for one by one, because there are simply too many cases involved. Some of these details you won't discover — you have no way of knowing the AI would do that — until you've run it a good many times.


# Setup
* Just download the installer from release.

## Workflow

* Two modes: Solo (stable)
* Team (not fully polished yet — it can run, but requires orchestration; not recommended)

### Solo
* Just tell the AI: *"Load the math or node_information skill, and help me build something in Blender."*

> I say "or" because some tasks are simple enough that no math verification is needed — the AI can look up the nodes and build directly. Sometimes the AI will load the math skill on its own, but ultimately that is up to you.

>There's also a minor issue that comes up sometimes: the AI doesn't always use bpy or Blender Data, and instead goes straight to the more low-level blender_run to write its own code. I'm still working out how to fix that. But at the start of each task, you can ask it to use the first two tools more, and only fall back to the last one when necessary.

* After one skill finishes its task, the AI will load the next skill by itself; it does not load all of them at once (occasionally it does, but that is rare). Also, sometimes after finishing one skill the AI may fail to load the next one (this happened in my testing, but it is also rare).

### Team

* There are still skills, but I've divided them into tiny domains — each AI only has to focus on one small piece.
> The initial flow is not fully polished yet, but Solo mode is usable.

> I've grown thoroughly tired of designing. I try to make every tool as straightforward as possible — nothing like weights, which are vague and need heavy testing. Everything is a fairly rigorous runtime design (not rigorous in how the code is written, but in the method of solving the problem).

> But in the end there are still too many usable tools, which means I'd need a lot of testing before I can define a workflow. I think the team mode should be a good approach, but I may not be able to handle it. In the end the only thing I can do is converge the final set of tools, verify whether they're worth keeping, and then I'll stop updating. I've run out of good ideas. Unless I can figure out how to structure context — by what means to orchestrate and organize it so it stays at low occupancy (say 10–15%), which would keep the AI focused and undistracted; attention is a scarce resource. But organizing it costs a lot — a lot, a lot, a lot.

# Tool and depend

<details>
<summary>Show Tool descriptions</summary>

* These are nothing more than thin wrappers around the tool calls; all the real backend logic lives in the Python files.

## Depend
### Skills

- **math** — used for early-stage math verification in Python; some packages need to be installed (see [Python environment](#python-environment))
- **node_information** — the node information tool mentioned earlier; a database containing detailed info about geometry nodes
- **execution** — a tool for building and testing

### blender
* [Blender-ai-geometry-nodes-trace](https://github.com/DaTingYeQing/Blender-ai-geometry-nodes-trace) — **experimental; it is already bundled and downloaded with the installer, but not ready yet**, **and it is only available in Team mode**

### Python environment
* The dependencies are bundled into the Python interpreter that ships with Blender 4.5.

## Tool

### mesh_probe
* Used as a probe into the code underlying the procedural mesh, it extracts the mesh state at various points in the geometry flow.

### blender_fit

*A tool that translates code written in some special notation into node graphs; given a specified output and a given search range, let Optuna fit it and see whether a result can be found.
> Not certain, but at least it's some progress.

### covtrace.ts

* A tool that lets the AI understand how a node is implemented internally.
>Maybe?

### blender_math.ts

* Lets the AI build math nodes quickly. The AI only needs to enter a math expression in this front end, and the background script automatically verifies it (`eval`) and builds the node group (`build`).

### blender_build.ts

* Lets the AI operate on the node tree quickly (`add`, `link`, `unlink`, `del`, `set`, `interface`, `add item`). The AI just needs to write small entries in the given format to perform the operations.

## blender_screen.ts

* This is the AI's eyes. It lets the AI quickly see which nodes exist in the node tree (**rough mode**), and which socket on a specific node is connected to which other node's socket (**detailed mode**).

### bpy.ts

* This is the bridge to the external Python. The AI uses it to export models from inside Blender directly to Python, and with the help of the external packages () it can read the data it wants.

### node_query.ts

* Gives the AI static and dynamic information about nodes. From a vague memory, the AI can first find a node's idname (**find mode**), then enter the idname to get the full details of that node (**node full mode**).

### wf_plan.ts

* A modular task list. The AI calls this tool after completing the early-stage testing.


### blender.ts

* A fixed channel for sending scripts into Blender. When the tools above cannot help the AI, it will write code directly and send it to Blender to get what it wants.

### hook_skill.ts

* Updated the skill prompts and added a new hook skill that automatically tells the AI which skills to load during wf_plan.


</details>
