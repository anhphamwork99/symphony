# Optimize or safely reject oversized images

When an imported image exceeds measured safe canvas bounds, Synara creates an appropriately resized or compressed representation. If it remains unsafe or optimization would be unacceptable, the import fails with a clear diagnostic rather than risking an unresponsive canvas. Image binaries remain separate from element and chip metadata.
