---
name: add-model
description: "Add lines, models or references under src/data/lines and src/data/models, and reconcile them with what the brand's file says. Use whenever a model or reference is imported or added, by hand or from a script."
---

New models can contradict what we already hold about their brand. The build
catches the contradictions it can see (`checkModelsAgreeWithBrands` in
`src/lib/consistency.ts`); this checklist covers the rest. When the new data and
the brand disagree, find out which is wrong before changing either. Don't edit
the brand just to make the build pass.

1. **The brand exists and is complete.** If it doesn't exist yet, add it first
   with the `add-brand` skill.
2. **Files sit where their parents say.** Lines live at
   `lines/<brand>/<line>.yaml` and models at `models/<brand>/<line>/<model>.yaml`.
   The folder must match the `brand:` or `line:` the file names.
3. **Movement type on every reference that has a calibre.** Set `movementType`
   to `mechanical` (Spring Drive included) or `quartz` (solar, kinetic and GPS
   included), from the maker's spec page. Leave it out for smartwatches.
4. **Makes agrees.** A `mechanical` reference needs `mechanical-watches` in the
   brand's `makes`, a `quartz` one `quartz-watches`, and a `style: smartwatch`
   model `smartwatches`. The build fails otherwise. If the brand's list is what's
   missing, add the kind with a source in the brand's `sources`.
5. **Dates agree with the brand.** A line or reference dated before the brand was
   founded fails the build. Also check that none was on sale while the brand was
   dormant. If the dates disagree, check both to find which is wrong.
6. **The owner fits.** A model sold under license, or made by a group that
   isn't the brand's recorded owner, can mean `ownership` or `licensees` is out
   of date. Check, and update with sources.
7. **Collaborators exist.** Brands named in `collaborators` must have their own
   brand file (use `add-brand`).

Then run `npm run check` and `npm run build`. If anything in the brand's file
changed, say so in the PR.
