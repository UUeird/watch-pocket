#!/usr/bin/env bash
# Checks that each data rule really fails the build: breaks one data file at a time, builds, then restores it.
# Run from the repo root with `npm run test:rules`, with the dev server stopped.
set -u

# The dev server shares Astro's content cache with these builds and can be left serving a broken file's error.
if npx astro dev status 2>/dev/null | grep -q 'running at'; then
  echo "Stop the dev server first: npx astro dev stop" >&2
  exit 1
fi
D=src/data
failures=0

try() { # description, file, sed expression that breaks it
  cp "$2" "$2.bak"
  sed -i.tmp -e "$3" "$2" && rm -f "$2.tmp"
  if npm run build >/dev/null 2>&1; then
    echo "NOT CAUGHT  $1"
    failures=$((failures + 1))
  else
    echo "caught      $1"
  fi
  mv "$2.bak" "$2"
}

try "period ends before it starts" $D/brands/omega.yaml 's/{ from: 1848 }/{ from: 1848, to: 1800 }/'
try "earlier period left open-ended" $D/lines/rolex/milgauss.yaml 's/{ from: 1956, to: 1988 }/{ from: 1956 }/'
try "overlapping periods" $D/lines/rolex/milgauss.yaml 's/{ from: 2007, to: 2023 }/{ from: 1980, to: 2023 }/'
try "two current owners" $D/brands/girard-perregaux.yaml '/to: 2022/d'
try "two references with the same URL" $D/models/rolex/submariner/submariner.yaml 's/ref: "124060"/ref: "114060"/'
try "line filed under the wrong brand" $D/lines/rolex/milgauss.yaml 's/^brand: rolex$/brand: omega/'
try "model filed under the wrong line" $D/models/rolex/submariner/submariner.yaml 's#^line: rolex/submariner$#line: rolex/datejust#'
try "model style outside the list" $D/models/rolex/submariner/submariner.yaml 's/^style: dive$/style: diver/'
try "split-seconds without chronograph" $D/models/richard-mille/rm-65/rm-65-01.yaml 's/\[date, chronograph, split-seconds\]/[date, split-seconds]/'
try "status set alongside periods" $D/brands/omega.yaml 's/^segment: /status: active\
segment: /'
try "current stakes over 100 percent in total" $D/brands/girard-perregaux.yaml '/to: 2022/d;s/^  - owner: .*/&\
    stake: 60/'
try "part-owner alongside an owner with no stake" $D/brands/girard-perregaux.yaml '/to: 2022/d;s/^  - owner: sowind-group$/&\
    stake: unknown/'
try "brand listed as its own owner" $D/brands/kenissi.yaml 's/{ brand: tudor }/{ brand: kenissi }/'
try "owner that does not exist" $D/brands/kenissi.yaml 's/{ brand: tudor }/{ brand: no-such-brand }/'
try "basis with no source" $D/brands/girard-perregaux.yaml 's/^  - owner: sowind-group$/&\
    basis: reported/'
try "stake over 100 percent" $D/brands/girard-perregaux.yaml 's/^  - owner: sowind-group$/  - owner: sowind-group\
    stake: 120/'
try "source that is not a link" $D/brands/girard-perregaux.yaml 's/^  - owner: sowind-group$/  - owner: sowind-group\
    sources: [kering press release]/'
try "logo file that does not exist" $D/brands/rolex.yaml 's#logos/rolex.svg#logos/missing.svg#'
try "logo credit with no logo" $D/brands/rolex.yaml '/^logo: /d'
try "logo credit with no source" $D/brands/rolex.yaml '/^  source: /d'
try "logomark file that does not exist" $D/brands/louis-vuitton.yaml 's#logos/louis-vuitton-logomark.svg#logos/missing.svg#'
try "logomark with no logo" $D/brands/louis-vuitton.yaml '/^logo: /d;/^logoCredit:/,/^  license: /d'
try "logomark credit with no logomark" $D/brands/rolex.yaml 's/^logoCredit:$/logomarkCredit: { source: https:\/\/example.com, license: Public domain }\
logoCredit:/'
try "dark logo file that does not exist" $D/brands/tissot.yaml 's#logos/tissot-on-dark.png#logos/missing.png#'
try "dark logo with no logo" $D/brands/tissot.yaml '/^logo: /d;/^logoCredit:/,/^  license: Public domain$/d'
try "dark logo credit with no dark logo" $D/brands/tissot.yaml '/^logoOnDark: /d'
try "logo background that is not a color" $D/brands/diesel.yaml "s/^logoBackground: .*/logoBackground: red/"
try "group logo file that does not exist" $D/groups/kering.yaml 's#logos/kering.svg#logos/missing.svg#'
try "group logo credit with no logo" $D/groups/kering.yaml '/^logo: /d'
try "revenue with no source" $D/brands/breguet.yaml 's/^name: Breguet$/name: Breguet\
revenue: [{ year: 2024, amount: 1, currency: CHF, basis: estimate }]/'
try "two revenue figures for one year" $D/groups/intel.yaml 's/^name: Intel$/name: Intel\
revenue:\
  - { year: 2024, amount: 1, currency: EUR, basis: reported, sources: [https:\/\/example.com] }\
  - { year: 2024, amount: 2, currency: EUR, basis: reported, sources: [https:\/\/example.com] }/'
try "revenue in an unknown currency" $D/brands/breguet.yaml 's/^name: Breguet$/name: Breguet\
revenue: [{ year: 2024, amount: 1, currency: XYZ, basis: estimate, sources: [https:\/\/example.com] }]/'
try "group with neither control nor a parent" $D/groups/kering.yaml '/^control: /d'
try "group with both control and a parent" $D/groups/breitling-sa.yaml 's/^parent: partners-group$/&\
control: private/'
try "group control outside the list" $D/groups/kering.yaml 's/^control: public$/control: luxury-group/'
try "heritage after the brand's own founding" $D/brands/arnold-son.yaml 's/^  from: 1764$/  from: 2000/'
try "heritage with no source" $D/brands/arnold-son.yaml '/^    - https:\/\/www.thehourmarkers.com/d; s/^  sources:$/  sources: []/'
try "model photo credit with no license" $D/models/rolex/gmt-master-ii/gmt-master-ii.yaml '/^          license: Public domain$/d'
try "model photo that does not exist" $D/models/rolex/gmt-master-ii/gmt-master-ii.yaml 's#gmt-master-ii.jpg#no-such-photo.jpg#'
try "the same model photo twice" $D/models/rolex/gmt-master-ii/gmt-master-ii.yaml 's#File:Rolex_GMT_Master_II_-_16710_in_it_sitting_on_top_of_the_box.jpg#File:Rolex_GMT_Master_II_Pepsi.jpg#'
try "model website that is not a web address" $D/models/richard-mille/rm-67/rm-67-02.yaml 's#^website: .*#website: richardmille.com#'
try "new brand missing a fact" $D/brands/rolex.yaml '/^segment: /d'
try "listed gap that has been filled in" $D/brands/47zero.yaml 's/^origin: France$/&\
segment: budget/'
try "gap list naming a brand that does not exist" $D/known-gaps.json 's/"47zero"/"no-such-brand"/'
try "smartwatch under a brand without smartwatches" $D/brands/apple.yaml 's/^makes: \[smartwatches\]$/makes: [quartz-watches]/'
try "mechanical reference under a brand without mechanical watches" $D/brands/rolex.yaml 's/^makes: .*/makes: [quartz-watches]/'
try "quartz reference under a brand without quartz watches" $D/brands/seiko.yaml 's/^makes: .*/makes: [mechanical-watches]/'
try "movement type outside the list" $D/models/rolex/submariner/submariner.yaml 's/movementType: mechanical/movementType: automatic/'
try "line dated before its brand was founded" $D/lines/rolex/milgauss.yaml 's/{ from: 1956, to: 1988 }/{ from: 1900, to: 1988 }/'
try "brand founded after one of its references" $D/brands/rolex.yaml 's/^periods: \[{ from: 1905 }\]$/periods: [{ from: 2030 }]/'
try "core brand with a gap" $D/known-gaps.json 's/^{$/{\
  "rolex": {"segment": null},/'
try "search date that is not a date" $D/known-gaps.json 's/"47zero": {"makes": null}/"47zero": {"makes": "last week"}/'
try "gap list naming a fact that does not exist" $D/known-gaps.json 's/"47zero": {"makes": null}/"47zero": {"logo": null}/'

exit $failures
