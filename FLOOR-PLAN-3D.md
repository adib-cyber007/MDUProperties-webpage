# Floor-plan 3D previews

## Pretrained floor plan recognition

Run `npm run start:floorplan` to start the local CPU model service and this site.
The floor editor uses the restored FLRplanner-derived CubiCasa5K pipeline for
walls, doors, windows, fixed fixtures and room predictions on automatic uploads
and **Detect walls again**. The browser also proposes movable furniture. Review
the resulting wall and opening tracing before saving; recognition may still
confuse unfamiliar drawing details. A failed service preserves the existing
tracing.

**Recognition method** offers **Automatic**, **FLRplanner**, and **Coloured walls**.
Automatic keeps the existing detector for ordinary drawings and selects a
separate method for strong solid coloured wall strips. That method emits straight
horizontal/vertical wall runs and excludes black annotation borders from wall
geometry. Select FLRplanner to bypass routing. Change the method, choose
**Detect walls again**, review, then save. The separate method's detail detections
remain proposals; unusual openings and main entrances still need review.

Walls and openings use the previous FLRplanner-derived geometry handling,
including opening surrounds. Furniture suggestions appear automatically and
require **Add to model** before placement.
**Find doors & windows** and **Find items in drawing** can rescan those details.
The existing calibration, editing, private drafts, GLB/OBJ/JSON exports and
walkthrough use the accepted geometry.

The import now adapts the recognition handling in the local FLRplanner project
(`src/recognizeDrawing.ts` and `shared/recognition.ts`). Drawing uploads preserve
PNG linework when it fits the size limit and flatten transparent backgrounds to
white. Furniture proposals outside the recognized wall bounds are discarded;
neural fixtures take precedence over nearby image-rule proposals. Suggestions
outside this editor's supported item sizes are marked skipped instead of resized
to arbitrary minimum/maximum sizes.

The combined MitUNet/OCR pipeline remains available for comparison by setting
`FLOORPLAN_ENGINE=mitunet` after installing its dependencies and checkpoint. That
optional engine filters measurements/text, preserves structural gaps, and keeps
uncertain walls outside 3D for **Add reviewed wall** or **Discard**. **Show ignored
measurements and text** displays its filtering regions. Review metadata persists
in drafts and layout JSON. This engine is no longer selected by default.

**Show predicted rooms** overlays the model's room polygons on the drawing and
shows their class confidence. These outlines stay in saved drafts and layout
JSON, follow drawing calibration, and never create extra room boundary walls.
They remain predictions; manually editing walls does not update the polygons.
For an existing drawing, choose **Detect walls again**, review the replacement,
then save to retain these new results. Undo restores the preceding tracing.
FLRplanner supplies the retained drawing/import and walkthrough adaptations.
The default structural walls, openings and fixed fixture suggestions come from
FLRplanner's CubiCasa checkpoint. Published model scores do not establish accuracy
on a new drawing style; inspect the overlay and manually review geometry.

See [services/floorplan/README.md](services/floorplan/README.md) for setup,
standalone inference, API contracts, tests and noncommercial research licensing.
Recognition sends the drawing and its entered dimensions to the configured
service. It does not save or publish automatically. The same editor appears in
**Previous projects → Edit → Floor plan and 3D model**.

## Paint by Asian Paints shade name

Open **Floor plan & 3D → Finishes**. Type an **Interior paint name** and an **Exterior paint name** separately, check each swatch and shade code, then choose **Apply interior paint** or **Apply exterior paint**. Enter also applies the focused field. Names and shade codes are accepted without case sensitivity; Buttercup resolves to **Buttercup-N (0336)** and Apricot to **Apricot-N (0501)**. Partial names offer matching suggestions; unknown or ambiguous names never change the model.

Paint applies to all corresponding wall faces on the selected floor, replacing individual overrides on that side. The opposite side, flooring, ceiling, geometry, furniture and dimensions stay as saved. Select another floor to paint it separately. Undo restores the previous finishes. The floor and combined-building previews update, and saved projects, layout JSON and detailed GLB exports retain the shade names and codes. Older finishes remain visible until you replace them.

**Flooring, ceiling & custom finishes** contains the material library and uploaded texture controls. **Wall face direction** lets you correct which side of a wall is outdoors when the layout is incomplete.

The bundled catalogue contains 2,200 shade names, codes and digital swatches from [Asian Paints’ official DecorPro catalogue](https://www.asianpaints.com/decorpro/shades/colour-catalogues.html), retrieved on 9 October 2026. Screen colours are a preview; use a physical shade card for the final paint. This workflow needs no AI account or external request while choosing shades. The former style assistant and generation endpoint have been removed.

## Multi-floor buildings for current and previous projects

### Upcoming projects

Use **Owner dashboard → Upcoming projects → Add upcoming project** for a planned development. Enter a title, location and positive estimated price, then add its proposed area, project type, expected completion, address and description. Cover photos are optional while planning; the website uses its brand mark when no photo is supplied.

Use **Floor plan & 3D** to upload each floor drawing, review detected walls and furniture, and confirm the dimensions. Check **Show this 3D building on this property's page** and save to publish the model. Leave the box unchecked to keep the model and source drawing private while sharing project details. Projects can be saved before their model is ready.

Visitors find these entries at `/upcoming-projects` and in the homepage's Upcoming projects section. Prices and completion dates are labeled as estimates. Upcoming entries are excluded from Available homes. Change the listing type to Under construction or Ready for sale as the project advances; its saved model is retained. Those listing types require a cover photo. Upcoming metadata uses the existing listing store and requires no database migration.

Saving, signing in, image processing and downloads display progress immediately. Save buttons stay disabled until completion and recover on errors. The combined building preview loads when opened, avoiding a second hidden model during editing. `npm run test:editor:browser` also verifies upcoming creation, publication, retry feedback and the public walkthrough with an isolated store.

Open **Admin → Listings → Edit** for a current property, **Previous projects → Edit** for a completed property, or **3D Projects → Edit** for a standalone showcase. Each has the same optional building editor; no model is required to save a property.

The owner form separates property details, photos (where applicable), and **Floor plan & 3D** into tabs. Inside the 3D workspace, **Drawing & scale**, **Walls & openings**, **Finishes**, and **Furniture** group the tools while keeping the drawing and floor preview available. Wide screens show the preview beside the tools; smaller screens stack them. Switching sections keeps your edits; the save button stays at the bottom of the screen. Required fields reveal their section when validation fails.

Expand **Drawing source & recognition** to upload or replace a drawing, and **Advanced recognition options** to select the recognition profile or enable local vision review. **Floor alignment & slab settings** contains offsets and slab thickness. Use **Review entire building in 3D** for the combined preview. Each preview's **View options & downloads** contains full walls, ceiling controls, image/GLB export and rendering quality; **Export this floor** contains OBJ and layout JSON. Run `npm run test:editor:browser` for isolated desktop/mobile navigation, editing, validation, export and save/reopen checks using a synthetic model.

1. Choose **Number of floors**, including the ground floor (1–8).
2. Choose **Edit floor**, starting with **Ground floor**, and upload its PNG/JPEG/WebP drawing. Export PDF pages as images first. Wall detection builds an initial layout; review walls/openings, calibrate or confirm the real dimensions, and enter the wall height. Add/review furniture using the existing controls.
3. Select **First floor**, then any further floors, and upload the corresponding drawing for each. Switching floors retains edits. Blank floors can be saved as drafts.
4. Review **Combined building preview**. Ground floor is always at elevation zero. Each upper floor is placed above the previous floor's wall height, plus the upper floor's slab thickness. Slabs extend down from the finished floor level. Inputs and offsets are in feet; rendering and GLB exports use metres.
5. Plans initially align at their centres. Use each floor's left/right and front/back offsets to align a common reference such as a stairwell or outside wall. Differently cropped images are not automatically registered. All floor drawings should use the same orientation.
6. Enable **Show this 3D building on this property's page**, then save the property. Publishing requires a drawing, reviewed scale and at least one wall on every floor. An unchecked box saves privately. The public card gains a **3D view available** badge; its detail page shows the building and source drawing for every floor.
7. Visitors can select **All floors** or one floor, orbit/pan/zoom, change full/cutaway walls, and save an image. Choose **Walk through** for first-person exploration. In the editor, GLB export follows the selected floor visibility and wall display; select **All floors** and **Show full walls** to export the full building.

To edit later, reopen the same property. Reducing the floor count asks for confirmation if it would remove uploaded upper floors; the change persists only when the property is saved. Removing a drawing or clearing all floors does not delete the property. Unpublish before saving an incomplete building.

### Walkthrough from FLRplanner

**Walk through** is available in every 3D preview and on every published property, portfolio and standalone-model page. It uses the project's existing saved floor plans, furniture and finishes. The movement/slide logic and drag-to-look controls are adapted from `FLRplanner/shared/walkthrough.ts` and `FLRplanner/src/SceneView.tsx`; the adapter in `src/floor-plan-walkthrough.cjs` prepares this website's normalized, feet-based wall/opening data for movement in metres. FLRplanner remains a separate project.

Walking starts in a clear room with full-height walls and a ceiling, at 1.65 metres above the selected finished floor (or lower for a low ceiling). Drag to look; hold W A S D, arrow keys or the on-screen arrows to move. Doors remain passable; solid walls, windows, furniture and the floor boundary block movement. The camera slides along obstacles. Closed concave outlines restrict movement to their interior; incomplete drafts stay within the presentation slab.

In a building, entering the walkthrough selects the current floor, or the first populated floor when **All floors** is selected. Choose another floor to start there using its real elevation and alignment offsets. Floor changes are selected directly; stairs are not generated. Resizing and expanding the view preserve the heading. **Restart walkthrough** or Home returns to the starting point; **Exit walkthrough** or Escape restores the saved overview. In an expanded view, a second Escape closes the large view. Rendering stops when idle, hidden or outside the viewport, and movement clears on blur.

The browser bundle is built by `npm run build` and served from this website. A recognition service and AI credentials are only needed for their optional authoring features, not for walking through a saved model. Hosting setup is in [HOSTING.md](HOSTING.md). Run `npm run test:walkthrough:browser` for the isolated public-page and mobile checks.

Existing version-1 single-floor models continue to render. Opening and saving one through the building editor wraps it as the ground floor of a version-2 model. No bulk data rewrite is needed. The optional `floorPlan` field now supports `{ version: 2, unit: 'ft', published, floors: [{ name, plan, slabThickness, offsetX, offsetZ }] }`. The server assigns ordered names and computes elevations; it does not trust client-supplied elevation values. Draft model data is omitted from public listing and portfolio responses. Unrelated property edits preserve the model.

Limits apply per floor: 250 wall/opening segments, 100 furniture items, 2,500,000 image characters. Combined building images are limited to 10,000,000 characters. Floor-plan detection remains a reviewed layout aid: roofs, stairs, slab openings, exterior details and structural accuracy are not inferred. This release adds reusable floor stacking and property integration; it does not claim photorealistic or construction-ready reconstruction from drawings.

Verification: `npm run check` and `npm test` include building validation, ground-up placement, slab/offset geometry, legacy data, and persistence/privacy across all three record types. The local `.playwright-mcp/verify-building.cjs` harness uses an isolated temporary store to exercise uploads, draft/reopen/publish, listing editing, portfolio/listing viewers, mobile layout, floor visibility and GLB export in Edge.

## Optional models for portfolio projects

Open **Admin → Previous projects → Edit** (or **Add previous project**) and find **Optional 3D view**. Every portfolio entry can have its own floor plan and model. No floor plan is required to save or publish the portfolio project itself.

Upload the drawing and the system will detect long, straight walls and build an initial 3D layout in the browser. Check the result against the drawing, enter its actual width and depth, and confirm those dimensions. Correct missed or mistaken walls; doorways and windows need to be marked separately. Save while the visibility checkbox is off to keep a draft. When ready, enable **Show this 3D layout on the project page** and **Save project**. A 3D viewer appears on that specific project's page and a **3D view available** badge appears on its portfolio card. Existing sold/not-for-sale labels remain visible. Projects without published models have no empty 3D section. Removing a floor plan or switching off visibility removes its public viewer after saving.

Portfolio drawings and models are stored in that project's optional `floorPlan` field through the existing `/api/admin/projects` endpoints. Public project responses omit draft drawings and models. Changes to unrelated project fields preserve a saved floor plan.

## Standalone 3D projects

Open **Admin → 3D Projects → Add 3D project** (or **Edit**). Enter a project name. You can save this draft immediately and upload the drawing later. These entries are independent of portfolio projects and available-home listings.

1. Upload a PNG, JPEG or WebP image of one floor. Export a PDF page to an image first. Crop out the drawing sheet's title block and margins where possible.
2. The pretrained model segments walls, doors, windows, rooms and fixed fixtures, then converts them to editable geometry and a 3D preview. Use **Detect walls again** to replace traced geometry after confirmation. **Find doors & windows** uses the same model and adds candidates while preserving wall edits. Movable furniture uses separate image-rule suggestions and requires review.
3. New drawings start with a provisional 60 ft building long side and preserve the image proportions. **Building size** sets the wall span without counting blank margins. Enter the actual building width/depth and choose **Apply building size**, or calibrate a known printed distance with **Set scale from measurement**. Confirm the scale checkbox before publishing. Wall height and thickness remain separate measurements; calibration does not correct a skewed photograph.
4. Review all blue wall lines, dashed brown doors, and teal windows. Select or delete mistakes and add missed lines with **Wall**. Mark a missed opening along the wall centreline using **Doorway** or **Window**. Overlapping collinear walls are cut automatically; standalone openings in existing gaps are also supported. Openings must align with the wall, not run across it. Detected doors have illustrative open leaves in 3D; windows have transparent glazing, a sill and a lintel.
5. The editor proposes isolated, outlined furniture symbols in the drawing. Review each dashed amber shape, choose its type, then click **Add to model**. Suggestions are not saved or displayed publicly until accepted. Dismiss mistaken shapes. The detector intentionally leaves text, connected structural walls, and unclear symbols for manual review.
6. To add something the drawing does not show, choose an item type and **Place item on drawing**, then click its location. Select a saved item in the list or click it with the **Select** tool. Adjust its type, centre, width, depth, and rotation, then choose **Update selected item**. You can remove it or use Undo. Supported items include beds, sofas, tables, chairs, wardrobes, kitchen counters, sinks, toilets, appliances, and a generic item.
7. Drag the 3D preview to orbit, scroll or pinch to zoom, and right-drag or use two fingers to pan. Arrow keys rotate; + and − zoom; Home resets. Full walls at the actual height are shown by default; **Show cutaway walls** lowers them to reveal furniture, and **Show full walls** restores the actual height. Click furniture in the editor's 3D view to select it. **Auto** rendering adapts pixel density and shadow resolution to the viewport and scene size; **Fast** disables shadows, and **High quality** increases detail.
8. Select a wall in the drawing or in the Saved segments menu to edit its endpoints or delete it. Coordinates are in feet from the top-left of the image. Undo restores previous segment, furniture, dimension, and calibration changes within this editing session.
9. Click **Save 3D project** to keep the drawing and model. Draft entries remain available to the admin but are omitted from public model responses.
10. When reviewed, enable **Show this 3D layout on the project page** and save again. The public **3D Projects** page at `/3d-projects` displays published models. A navigation link appears once a model is published. Each model has its own `/3d-project/:id` page with the original drawing. Showcase entries do not imply sale availability.

You can save an entry with no drawing, or a drawing with no traced walls, as a draft. A published layout requires at least one wall. Portfolio projects also retain their optional Sketchfab field; neither a Sketchfab link nor a floor plan is required.

## What this model represents

### Surface finish library and ceiling view

The editor's **Walls, floors & ceiling** section includes 60 named color swatches and 68 preset finishes: 26 inside wall finishes, 10 exterior finishes, 24 floor finishes, and 8 ceiling finishes. Inside presets include plaster, paint, linen, striped, botanical, trellis, dotted and damask patterns, plus wood panels and slats. Exterior presets include render, paint, limestone/slate, timber cladding and concrete. Floor presets include wood, herringbone, chevron, tile, checker, marble, terrazzo, stone and concrete. These are procedural presentation textures rather than manufacturer samples.

Choose **Apply finish to** to edit inside wall faces, outside wall faces, flooring or ceiling on the current floor, or a selected wall's inside/outside faces separately. A perimeter wall can have indoor wallpaper facing the room and exterior render facing outdoors. Interior partitions receive the inside finish on both faces. For an individual wall, select it in Saved segments or on the drawing first. Its override remains when the corresponding floor-wide finish changes; **Reset this finish** returns only the selected face finish to its floor-wide default. Endpoint edits keep overrides and outside directions. Full wall redetection replaces individual finishes and directions along with the wall tracing, with Undo available; floor-wide finishes remain intact.

Automatic face classification floods the air around the traced layout with doors/windows included as boundary connections. It handles concave outlines and partitions within a closed envelope. Open/incomplete boundaries are shown for review and exposed faces use the exterior finish conservatively. Select a wall and use **Selected wall: inside / outside** to mark an interior partition, choose the outside face using the drawing's **Side 1** arrow, or restore automatic classification. Enclosed courtyards, open corridors and inaccurate wall tracings need manual review; classification does not infer room semantics. Directions and outside overrides persist with the model. The 3D renderer splits wall faces before merging materials, and preserves the distinction around openings and in GLB export. Older plans use an independent neutral exterior default rather than repeating their indoor finish outdoors.

Use the color picker or enter any six-digit hex color. The second color controls pattern lines or grout. Repeat size is in feet for one entire pattern sample; a sample may contain several tiles/planks. Direction rotates the pattern. Textures use surface dimensions and maintain vertical alignment through wall openings, rather than stretching a single image over every wall. PNG/JPG/WebP uploads are compressed to 768-pixel width and must be below 700,000 data-URL characters after compression. Custom images keep their aspect ratio when repeated; a white tint preserves their original colors. A seamless material sample works best. Each floor's drawing and texture data is limited to 5 MB combined; a building is limited to 10 MB combined.

**Show ceiling** toggles a flat plane at the actual wall height. **Ceiling view** enables full walls and places the camera inside looking upward, using the selected floor in a building. **Hide ceiling**, **Reset view** and **Top view** leave the interior ceiling view; reset/top also hide the ceiling so the layout can be inspected. Ceiling finishes are editable using the same palette, presets and custom uploads. The ceiling follows the existing rectangular display footprint, not an automatically inferred roof or room boundary. Beams, services, lighting layouts and false-ceiling levels are not inferred or modelled by these controls. The panel-grid presets are flat finish patterns.

Finishes are saved with the existing floor-plan model and returned through public APIs only under the existing publication rules. Older plans remain readable and use default finishes. Undo includes finish edits. **Download detailed 3D (.glb)** embeds the displayed materials and textures and includes ceilings only when visible; exports wait for custom images to load. OBJ remains a geometry-only format and does not include these finish textures or the optional ceiling plane. No image service, database migration or API key is required.

Regression coverage verifies preset validity, input/image limits, wall overrides through opening cuts and endpoint edits, independent upper-floor finishes, persistence/private-public round trips, custom image upload, undo/reopening, mobile layout, ceiling controls and textured GLB export. Surface tests cover rectangular, concave, reversed and rotated envelopes, partitions, door/window gaps, incomplete boundaries, manual directions, exterior-only locks and invalid outdoor wallpaper. Browser verification checks actual exported polygon normals/materials for different inside and outside finishes, rather than just counting materials.

The following recognition notes describe the browser's rule-based detector and its historical regression coverage. Default pretrained uploads now use the restored CubiCasa service for structural walls and openings; the browser rules continue to propose movable furniture. These rule-based checks do not establish the pretrained model's accuracy.

Wall recognition now measures sustained transverse ink bands and outlined-wall faces before grouping the layout. It uses those bands to establish the building bounds, reject thin external length/width guides even when they touch the building, and trim measurement extensions continuing along real wall axes. Thin interior partitions remain candidates; label leaders and attached single-stroke furniture outlines need structural junction evidence. Short text strokes are not connected across whitespace as if they were doorway stubs, and annotation removal happens before the 250-segment model limit. Printed dimensions remain visible in the source drawing for scale calibration; they are not read as measurements or extruded into the model.

Furniture exclusion now checks the detected structure first. A proposed object containing half or more of the detected wall length is treated as potential building structure, preventing a small plan with wide page margins from being erased as furniture. This also excludes the building from furniture-only suggestions. During analysis, dimension, finish and tracing controls pause until the worker completes; edits can no longer silently discard the recognition result. Uploading another drawing still invalidates the previous job. Saving waits for image loading and automatic recognition to finish.

After a full scan, recognized door leaves are removed from the wall candidates so they do not become full-height partitions. The cleanup follows the detected hinge and swing and leaves longer neighboring walls intact. Opening-only rescans preserve manually traced walls. Door searches reject solid wall positions before testing curves, accept larger symbols on supported scans, and size the minimum window length to the drawing. Analysis retains up to 1536 pixels along the uploaded image's longest edge to preserve more small symbol detail. Existing projects can use **Detect walls again** to rebuild wall candidates with these filters, then review and save the result; existing wall edits are not silently replaced on reopening.

Added regression coverage includes connected dimension rails and collinear extensions, attached label/furniture strokes, thinner interior partitions, text-heavy sheets, bold door leaves, both hinge/swing directions on rotated axes, small glazing, and large door symbols. Tests exercise the worker, validation, opening subtraction, 3D boxes and OBJ export. These checks establish behavior on controlled drawings, not general recognition accuracy. The saved 332 × 187 example still has unresolved windows and needs a larger original or manual marking. Faint interior boundaries can resemble glazing, so window recognition continues to require sustained contrast between strokes and panes.

Window recognition now uses drawing-relative cross-sections for larger scans and local contrast for faint glazing even when dark annotations or walls appear elsewhere on the sheet. Door stroke checks also scale with the drawing. A continuous double-line wall is no longer accepted as a full-length window solely because its interior is bright. Full-length glazing remains ambiguous and may need manual marking. Use **Find doors & windows** to add newly recognized openings to existing tracings, or **Detect walls again** to replace and review an older detection result.

Regression tests cover mixed dark/faint drawings, larger symbol strokes, continuous outlined-wall rejection, and the complete detection worker through validated door/window geometry and OBJ export at 400, 800 and 1200 pixels. These are synthetic test drawings, not an accuracy benchmark on architectural plans.

The current recognizer also searches angled wall axes, faint door strokes on shaded paper, and door gaps ending at a crossing wall. It compares candidate arcs with nearby curves to reject repeated hatching. Faint glazed strips are supported on scans with little dark ink, with bounded segments required to avoid treating an entire shaded wall as a window. Detected door hinge endpoints and swing directions are saved and used by the 3D model on every floor; the displayed leaf remains illustratively open at 60 degrees. These are reviewed candidates, and the tiny 332 × 187 drawing still has unresolved windows. Rotation, faint symbols, blank passages, furniture rejection, and upper-floor door direction have regression coverage.

Opening recognition searches across aligned wall gaps and adjusts door-swing sizes to the drawing. Windows have visible frames as well as glazing, and the editor shows persistent door/window counts. Older saved tracings receive an openings-only scan on reopening; older drawings without any segments receive a full scan. These changes remain an editable draft until saved. Low-resolution uploads show a warning: tiny or faint symbols may still require a higher-resolution original or manual tracing.

This version detects long straight lines in upright single-floor drawings, then builds an interactive 3D layout from proposed walls. It favors the connected wall network so detached measurement guides and furniture outlines are less likely to become walls, and proposes door-swing arcs and thin glazed wall strips as openings. These image heuristics are conservative, not a complete architectural-symbol recognizer: review every door/window and add or remove any it gets wrong. It also proposes outlined symbols and substantial colored furniture regions for review. Furniture suggestions still require owner confirmation and labeling; the system does not reliably identify every object. Items in the 3D view are simplified shapes, not product-specific models. Dimension lines, text and complex wall outlines can still need correction. Printed dimensions are not read automatically. The system does not infer exterior elevations, roofs or finishes. Doors use a 6.8 ft opening and an illustrative open leaf; windows have a 3 ft sill and 6.5 ft head. These heights are illustrative. The rectangular display base follows the wall extents with a small margin, rather than the full image or a measured site boundary. Wall and furniture positions still use the full image coordinate system, so calibrating against a printed measurement is essential when the image has whitespace. The model is a presentation aid, not a construction drawing or surveyed model.

Best input: a crisp PNG exported from an architect's plan, one floor per image, with walls and openings visible. Remove title blocks, furniture-heavy overlays and unrelated details where practical. Retain at least one known real measurement for calibration; also supply actual wall height and thickness. Keep the original PDF/CAD as your reference, but export PNG for the current uploader. A perspective phone photograph or low-resolution screenshot is less reliable. Automated tests cover synthetic outlined walls, door gaps, low-contrast diagonals, calibration and opening subtraction; real project drawings still require owner review.

The preview uses the same Three.js version and adapted furniture models as the owner's FLRplanner project, with rounded furniture, textured wood flooring, soft shadows, and perspective orbit controls. It requires WebGL 2. It loads only when a model needs rendering; the main home page does not download the 3D engine. Wall and furniture analysis runs in a background worker. Outdated analysis results are discarded when the owner changes the drawing.

Scene geometry remains on the GPU during camera movement. Walls are instanced, furniture is merged by material, source furniture geometry and materials are reused, and unchanged editor selections do not rebuild the model. Rendering stops after camera damping settles, when the viewer leaves the viewport, and when the browser tab is hidden. Resources are disposed when the viewer is removed. These changes improve interaction and idle resource use; detailed model creation can still take time on slower devices.

The **Download 3D model (.obj)** button exports the floor, wall, opening, and accepted furniture geometry for further work in a modelling application. Units are feet, with Y as the vertical axis. OBJ output contains geometry only, not textures/material files.

**Save image** exports a PNG of the current camera view. The editor's **Download detailed 3D (.glb)** exports the displayed scene, including detailed furniture and materials, in metres. It preserves the current cutaway/full wall display, which starts with full walls; if you switch to cutaway, select **Show full walls** before export for the actual wall height. The OBJ export continues to use the original full-height geometry.

## Storage and deployment

Standalone records are stored in the `models` collection inside the same `site_store` document used by the admin panel. Each record has a name, optional location and description, and optional `floorPlan` containing the drawing, dimensions, segments and publication setting. Authenticated creation, updates and deletion use `/api/admin/models` and `/api/admin/models/:id`. Public `/api/models` and `/api/models/:id` return published models only. No new database, bucket, environment variable, service or migration is required.

Existing projects without this field continue to work. PNG/JPEG/WebP data URLs are validated server-side; SVG and external image URLs are rejected for this feature. Models are limited to 250 segments and 2,500,000 image characters. The renderer and editor are served locally and require no external JavaScript or API key.

The renderer source is in `src/floor-plan-renderer.js` and `src/furniture-3d.ts`. Run `npm ci` and `npm run build` after changing these files. The generated `public/floor-plan-renderer.js` is checked in so a plain `node server.js` also works. The build uses pinned Three.js 0.180.0 and esbuild 0.28.2. The Three.js license is included in `public/THREE-LICENSE.txt`.
