import type { ScheduleRule } from "../api/client";
import { DAY_NAMES } from "../format";

export function ScheduleEditor({ value, onChange }: { value: ScheduleRule[]; onChange: (v: ScheduleRule[]) => void }) {
  const update = (i: number, rule: ScheduleRule) => onChange(value.map((r, j) => (j === i ? rule : r)));

  return (
    <div className="schedule">
      {value.length === 0 && <p className="muted small">Ingen tidsrom valgt: overvåker hele døgnet, alle dager.</p>}
      {value.map((rule, i) => (
        <fieldset key={i} className="rule">
          <legend className="sr-only">Tidsrom {i + 1}</legend>
          <div className="days">
            {DAY_NAMES.map((name, d) => {
              const day = d + 1;
              const on = rule.days.includes(day);
              return (
                <label key={day} className={`day ${on ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      update(i, { ...rule, days: on ? rule.days.filter((x) => x !== day) : [...rule.days, day].sort() })
                    }
                  />
                  {name}
                </label>
              );
            })}
          </div>
          <div className="row">
            <label>
              Fra <input type="time" value={rule.from} onChange={(e) => update(i, { ...rule, from: e.target.value })} required />
            </label>
            <label>
              Til <input type="time" value={rule.to} onChange={(e) => update(i, { ...rule, to: e.target.value })} required />
            </label>
            <button type="button" className="link" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              Fjern
            </button>
          </div>
        </fieldset>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...value, { days: [1, 2, 3, 4, 5], from: "06:30", to: "09:00" }])}>
        Legg til tidsrom
      </button>
      <p className="muted small">Tidene er norsk tid. Et tidsrom som slutter før det starter, går over midnatt.</p>
    </div>
  );
}
