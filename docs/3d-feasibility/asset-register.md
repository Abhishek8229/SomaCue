# Stage 4 asset register

Register for the SomaCue 3D feasibility spike. Scope: two locally served GLB
files behind one demonstration workspace, plus the still frames derived from
them for fallback states. Reviewed 31 October 2026.

No asset is shipped with an unknown or inferred licence. If a licence cannot be
established from the source record, the asset is not approved.

## Summary

| Asset | Entry / clip | Creator | Version | Format | Licence | Commercial | Modify | Redistribute | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Lumbar Spine - L4 | NIH 3D `3DPX-000379`, mesh `col_lombar_apenas_l4` | bgobbato | 3, published 5 Oct 2026 | GLB, 1,311,912 bytes | Public Domain (NIH 3D; licence link points to CC0 1.0) | Yes | Yes | Yes | Selected |
| Standing cat-cow | Desk Break `standing-cat-cow` | Shlomy Reshef | source tree `8d475aa` | GLB, 903,288 bytes | MIT | Yes | Yes | Yes, with notice | Selected |
| Lumbar Spine | NIH 3D `3DPX-000803`, mesh `a_-_col_dorsal` | bgobbato | 3, published 5 Oct 2026 | GLB download, about 26 MB | Public Domain (NIH 3D; licence link points to CC0 1.0) | Yes | Yes | Yes | Licence approved; not selected |
| Z-Anatomy | Repository models | Lluís Vinent Juanico / Z-Anatomy project | `PC-Version` branch, reviewed 31 Oct 2026 | Blend / FBX | CC BY-SA 4.0 at repository level, with mixed asset-level terms | Conditional | Yes, share-alike | Yes, share-alike | Rejected for this spike |
| OpenGym3D | Exercise library and motion sources | AssiamahS / OpenGym3D | `main`, reviewed 31 Oct 2026 | GLB / source | Repository MIT; bundled motion sources carry separate terms | Bundle: no | Bundle: no | Bundle: no | Bundle rejected; CC0 Mesh2Motion subset noted |

All shipped files are served from `public/assets/`. No remote model request is
made at runtime.

## Selected anatomy asset

### Lumbar Spine - L4

- **Source:** NIH 3D, entry `3DPX-000379`
- **Entry page:** <https://3d.nih.gov/entries/3DPX-000379>
- **Download used:** <https://3d.nih.gov/entries/download/379/3>
- **Creator:** bgobbato
- **Entry title:** Lumbar Spine - L4
- **Version:** 3
- **Created:** 28 June 2014
- **Published:** 5 October 2026
- **Category:** Anatomy
- **Local file:** `public/assets/anatomy/nih-3dpx-000379-l4.glb`
- **Format:** binary glTF 2.0 (`.glb`)
- **Size:** 1,311,912 bytes (1.25 MiB)
- **SHA-256:** `A8D05DE6C80901749F7704B07ECCB4E7B1B5339263A09CECE820D0CAE48D4D24`
- **Inspection:** one mesh, `col_lombar_apenas_l4`; 16,805 triangles; 50,415
  vertices.

**Licence.** The NIH 3D record labels the entry "Public Domain". Its licence
badge links to the Creative Commons CC0 1.0 Universal deed:
<https://creativecommons.org/publicdomain/zero/1.0/>.

**Rights recorded.**

| Right | Status |
| --- | --- |
| Commercial use | Allowed |
| Modification | Allowed |
| Redistribution | Allowed |
| Attribution required | No; credited in the interface and this register as good practice |
| Share-alike | No |

**Decision:** selected for the anatomy demonstration.

**Scope limit.** This is a single L4 vertebra, not a complete lumbar series.
The interface says so in the summary and in Asset notes. It must not be
presented as a full spine, a diagnostic model, or clinical evidence.

**Derived files.** `public/assets/fallback/l4-vertebra.png` is a 1200 × 900
capture of this model rendered by this prototype. It inherits the source
licence. It is a presentation fallback, not a new anatomical dataset.

## Selected movement asset

### Standing cat-cow

- **Source:** Desk Break exercise library
- **Repository:** <https://github.com/shlomorsh/desk-break>
- **Source file:** `library/exercises.glb`
- **Revision inspected:** GitHub tree `8d475aa476b2c0e9ec6d09d8558faf17161e19ef`
- **Creator:** Shlomy Reshef (parametric.co.il)
- **Clip:** `standing-cat-cow`, category "back and spine"
- **Local file:** `public/assets/movement/desk-break-standing-cat-cow.glb`
- **Format:** binary glTF 2.0 (`.glb`)
- **Size:** 903,288 bytes (881.6 KiB)
- **SHA-256:** `9AC83F2CC5F736BCFB4726583B13B9E7AD19973192EAB99BDCD34A2E8231752E`
- **Clip duration:** 2.833333 s
- **Inspection:** one animation, 48 channels, 16 joints.
- **Original source:** 9,760,072 bytes, 435 clips.

**Licence.** MIT. Full notice:
<https://github.com/shlomorsh/desk-break/blob/main/LICENSE>. The complete text
travels with the asset at
`public/assets/movement/desk-break-LICENSE.txt`.

Copyright (c) 2026 Shlomy Reshef (parametric.co.il).

**Rights recorded.**

| Right | Status |
| --- | --- |
| Commercial use | Allowed |
| Modification | Allowed |
| Redistribution | Allowed |
| Attribution required | Yes: copyright and permission notice must accompany copies or substantial portions |
| Share-alike | No |

**Modification.** The source library was trimmed with glTF Transform 4.5.1.
434 of 435 clips and 7,716 unused accessors were removed. The
`standing-cat-cow` clip itself is unchanged. The derivative remains under the
MIT terms above.

**Decision:** selected for the movement demonstration.

**Copy limit.** The four steps shown in the interface are the source steps. The
source's rep count is deliberately not shown and the prototype makes no dosage
or clinical claim. Playback speed changes the visual rate only; it is not a
prescription.

**Derived files.** `public/assets/fallback/standing-cat-cow.png` is a
1200 × 900 capture of the first frame rendered by this prototype. It inherits
the source licence.

## Reviewed but not selected

### NIH 3D 3DPX-000803 — Lumbar Spine

- **Entry:** <https://3d.nih.gov/entries/3DPX-000803>
- **Creator:** bgobbato
- **Version:** 3, published 5 October 2026
- **Licence:** Public Domain (NIH 3D; badge links to CC0 1.0)
- **Inspection:** full download about 26 MB, with a much denser mesh than the
  selected L4 scan. The entry's preview geometry is labelled with the mesh name
  `a_-_col_dorsal` and appears to cover a thoracolumbar region with ribs.

**Decision:** licence is approved, but the asset is **not selected** for this
screen. The scope is wider than "lumbar" and the file weight and density are
unnecessary for a single-screen feasibility test. It would need explicit
labelling as a thoracolumbar model if used later.

### Z-Anatomy

- **Repository:** <https://github.com/LluisV/Z-Anatomy>
- **Creator:** Lluís Vinent Juanico, featuring models from the Z-Anatomy
  project
- **Licence at repository level:** CC BY-SA 4.0
  (<https://creativecommons.org/licenses/by-sa/4.0/>)

**Decision:** rejected for this spike. The repository-level share-alike licence
would attach to derivatives, and the project documents mixed asset-level terms,
including non-commercial components. Clearing every mesh used in a commercial
product would take more review than the spike allows. Not approved as a bundle.

### OpenGym3D

- **Repository:** <https://github.com/AssiamahS/opengym3d>
- **Licence at repository level:** MIT
- **Asset-level position:** the repository documents mixed motion sources:
  CC0 Mesh2Motion clips, project-owned video capture, CMU data, and Mixamo clips
  whose terms allow use inside a project but not redistribution as files.

**Decision:** the bundle is rejected for this spike because its exported asset
set is not covered by a single clear licence. A future review may isolate the
CC0 Mesh2Motion subset and verify each exported GLB's provenance; that subset
is noted, not approved here.

## Supporting licences

| Item | Licence | Note |
| --- | --- | --- |
| Next.js, React, React Three Fiber, Drei, Three.js | MIT | Runtime dependencies; notices remain with their packages |
| Rethink Sans | SIL Open Font License 1.1 | Loaded through `next/font/google` and self-hosted at build time |
| Hanken Grotesk | SIL Open Font License 1.1 | Loaded through `next/font/google` and self-hosted at build time |
| Azeret Mono | SIL Open Font License 1.1 | Loaded through `next/font/google` and self-hosted at build time |

## Review rules applied

1. A model is used only when the source record states a licence that permits
   commercial use, modification and redistribution.
2. Public domain status is recorded from the source record, not inferred from
   the creator or the hosting platform.
3. MIT assets keep the full copyright and permission notice beside the file and
   in the repository.
4. Share-alike and non-commercial components are not mixed into the shipped
   prototype.
5. The interface states the scope of each asset and does not add clinical
   claims, reps, dosage or diagnosis.
6. Fallback stills are captures of the approved models from this build and
   inherit the source licence.
