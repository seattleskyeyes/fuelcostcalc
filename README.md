# Raw Fuel Cost Calculator

A mobile-first, static fuel-cost calculator for any vehicle. Estimate a trip from
miles and MPG, or calculate gauge-based job actuals using pump-fill calibrations.
Gasoline and diesel use the same math. Use a saved vehicle profile or run quick,
unsaved calculations. There are no accounts, dependencies, build tools, or
external requests.

## Try the POC

Open [fuel/index.html](fuel/index.html) in a modern browser. Start with **Estimate**:
enter round-trip miles, the job-day fuel price, normal-driving MPG, and the trip's
driving mix. For ordinary driving, leave all cargo/trailer miles at zero.
All units are miles, US gallons, and US dollars. The result is **fuel only**,
not the full cost of operating a vehicle.

The application also works when served by any static web server. All asset links
are relative, so the `fuel` directory can eventually be copied into a GitHub Pages
site at `/fuel/`. Publishing is intentionally not configured yet.

Open [fuel/preview.html](fuel/preview.html), or use **Open mobile / desktop
preview** in the calculator, to switch the same running calculator between
**360px mobile** and **1024px desktop** viewports. Switching does not reload the
calculator or discard form entries. The outer preview scrolls horizontally when
needed. This is a real iframe viewport, not a scaled screenshot; its saved data
uses the calculator's browser storage.

### Workflows

- **Vehicles:** use **Add / edit vehicle** to save a name, normal non-job MPG,
  three manual MPG penalties, and one- or two-tank setup. Each vehicle has its own
  active calibration. Form overrides do not edit the profile. Profile edits never
  rewrite saved jobs' MPG snapshots or calibration inputs. Start-up is always in
  quick mode; choose the appropriate saved vehicle from the selector.
- **Estimate:** enter a total trip distance, then assign miles to extra cargo in
  the vehicle, towing an empty trailer, and towing a loaded trailer. The remainder
  is normal driving. Count every mile once. Each penalty is independently
  subtracted from normal MPG, **never stacked**. All effective MPG values must
  remain positive. Quotes round fuel cost up to a $5 multiple.
- **Job actuals:** start and stop odometers are prominent and required for the
  default mileage-based method. Fuel is still an **estimate** from actual miles
  and the entered MPG/driving mix. Alternatively, use calibrated tank gauges;
  odometers are encouraged but optional for that method. Choose a saved vehicle
  to save jobs. Gauge jobs can be saved pending the next full fill.
- **Job-day prices:** enter the price applicable to the job date manually. Job
  actuals start with a blank price to encourage an explicit entry. A profile
  switch, calibration, or later refill never replaces that price. Correct it
  explicitly in history if needed. No live or historical prices are fetched.
- **Calibrate:** record gauge readings before filling and gallons pumped to 100%.
  Saved fills belong to the selected vehicle. In quick mode, **Use for this
  session** makes a calibration available to quick gauge actuals without saving
  anything. Temporary fills disappear on reload or **Clear quick calibrations**.
  Nominal capacities are only a comparison. Receipt, nominal-capacity, and
  out-of-band warnings remain available.
- **Pending jobs:** saving a fill offers only compatible pending jobs for that
  vehicle. Nothing is selected automatically. Finalizing changes the calibration
  and status, **not the original job-day price**.
- **History / Vehicles:** inspect all saved jobs, edit profiles and generic quick
  defaults, export/import JSON, or clear this calculator's data by typing `CLEAR`.

Switching vehicles clears unsaved gauge/fill readings to avoid applying one
vehicle's measurements to another. Trip mileages, dates, and job-day prices are
preserved. Calibrations and linked previous fills are isolated by vehicle and tank
count. For fill-to-fill MPG, explicitly select the immediately previous full fill
of that vehicle, with no intervening refuels, both tanks topped off where
applicable, and increasing odometers. Do not use gauge-drop actuals across
refueling or tank transfers. Weights and trailer profiles are not modeled.

## Data and privacy

Version 2 data includes vehicle profiles, jobs, calibrations, per-vehicle active
calibrations, and quick defaults. It retains the existing `fuelcostcalc.v1`
`localStorage` key so upgrades do not lose data. The JSON `version` is now `2`.
Quick calculations, temporary calibrations, trip estimates, and unsaved form
entries are not stored or exported.

Version 1 storage and backups migrate in memory, then persist as version 2 on
the next explicit save. Older jobs/fills remain **unassigned** because their
vehicle cannot safely be inferred. They retain original prices and calculation
results and remain viewable; old unassigned gauge jobs can still use their
unassigned saved calibrations in history. New profile jobs cannot use another
vehicle's or legacy unassigned calibration. Review old prices if they were
originally entered as refill/replacement prices.

Use **Export JSON backup** regularly. Import accepts version 1 or 2 backups up to 5 MB
and validates the entire file before saving:

- **Replace** replaces all calculator data after explicit confirmation.
- **Merge** preserves this device's defaults and existing records, skips exact
  duplicates, and keeps conflicting vehicles/fills/jobs as separate copies.
  Profile, active-calibration, previous-fill, and job links are remapped together.

Unreadable saved data is not silently overwritten. Saving is blocked until an
explicit replacement or clear; export can download the original data for recovery.
Storage failures and changes from another tab are surfaced rather than reported
as successful saves.

Browser storage belongs to its origin and browser profile. `file:` URL storage
behavior varies between browsers; use the same path/browser for local testing.
Moving to localhost or GitHub Pages will not automatically move data. Export
first and import on the new origin. Private browsing and clearing browser data
can remove local records. Backups may contain job names and notes you entered;
keep personal backups outside this repository.

## Math and tests

Open [fuel/tests.html](fuel/tests.html). It runs 30 focused tests with no test
runner or installation: baseline examples, rounding, four-mode mileage math,
odometer validation, price preservation, profile isolation, snapshot stability,
legacy migration, and conflict-safe backup merging.

- Rate = gallons pumped / (100 - gauge percentage before full fill).
- Job gallons = sum of each tank's gauge drop times its calibrated rate.
- Mileage-based gallons = sum of each driving mode's miles / its effective MPG.
- Cost = gallons times price per gallon.
- Intermediate calculations retain full JavaScript number precision. Display
  rounding converts the decimal representation into integer units with `BigInt`
  and rounds half-up, including `$147.475` to `$147.48`.

**Reviewed baseline correction:** the example job costs `$151.80`, versus a
nominal-capacity result of `$147.48`. As agreed during review, the comparison
subtracts the full-precision costs before rounding, yielding **$4.33**, not the
baseline's $4.32 obtained by subtracting the displayed totals. Calibration views
show gallons to three decimals; job and estimate views show two.

Implementation:

- [fuel/calc.js](fuel/calc.js): pure calculations and numeric validation, no DOM.
- [fuel/app.js](fuel/app.js): forms, history, local storage, and backup handling.
- [fuel/data.js](fuel/data.js): pure schema validation, migration, finalization,
  and reference-safe backup merging.
- [fuel/styles.css](fuel/styles.css): responsive layout and system light/dark mode.
- [fuel/tests.js](fuel/tests.js): browser calculation and saved-data regression tests.
- [fuel/preview.html](fuel/preview.html) and [fuel/preview.js](fuel/preview.js):
  mobile/desktop viewport controls.
