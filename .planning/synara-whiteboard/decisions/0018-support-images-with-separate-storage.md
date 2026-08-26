# Support images without embedding them in context chips

Whiteboards support images pasted from the clipboard, dropped onto the canvas, or chosen from Project Files. Image binaries are stored separately from Excalidraw element metadata and are never duplicated into selection chips; bounded size and loading policies are required to protect canvas and composer performance.
