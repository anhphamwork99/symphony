# Synara Whiteboard terms

## Project vocabulary

**Whiteboard**:
A named, Project-owned visual document where a person or AI can arrange drawings, text, shapes, connections, and other visual material.
_Avoid_: Canvas, Excalidraw file, Drawing

**Whiteboard tool**:
The Right-sidebar tool that opens and edits a Whiteboard in the existing tab system.
_Avoid_: Whiteboard panel, Whiteboard sidebar

**File canvas**:
A canvas tab opened from a Project `.excalidraw` file and saved back to that file. It is not a Synara Whiteboard unless the user explicitly imports it.
_Avoid_: Imported Whiteboard, Native Whiteboard

**AI Whiteboard edit**:
A user-requested change in which AI directly creates, modifies, or removes content from a Whiteboard.
_Avoid_: AI suggestion, Proposed edit

**AI edit batch**:
All Whiteboard changes produced by one user request, treated as one recoverable action.
_Avoid_: Individual AI operations

**Active Whiteboard**:
The Whiteboard currently visible in the selected Right-sidebar tab or Focus mode and therefore the default target for an otherwise unnamed AI request.
_Avoid_: Current canvas

**Focus mode**:
An expanded presentation of the same Whiteboard that temporarily uses the main working area while preserving the Whiteboard's tab, viewport, zoom, and Project ownership.
_Avoid_: Full-screen Whiteboard, Separate Whiteboard page

**Whiteboard selection chip**:
A lightweight reference in the Main composer to one selected Whiteboard element, used to give AI visual context without creating a separate Whiteboard chat. Its presence mirrors that element's canvas selection.
_Avoid_: Element attachment, Whiteboard prompt

**Whiteboard selection-set chip**:
A compact Main-composer reference representing a large selected set of Whiteboard elements when rendering one chip per element would exceed measured safe bounds.
_Avoid_: Truncated selection, Partial selection

**Take Over**:
The user action that stops an in-progress AI Whiteboard edit so the person can resume direct editing.
_Avoid_: Cancel Whiteboard, Unlock
