import { describe, expect, it } from "vitest";
import { isWithinSchedule, osloClock } from "../src/domain/schedule.js";

const weekdays = [1, 2, 3, 4, 5];

describe("osloClock", () => {
  it("bruker sommertid (UTC+2) i oktober før omstilling", () => {
    // Torsdag 15.10.2026 05:30 UTC = 07:30 norsk tid
    expect(osloClock(new Date("2026-10-15T05:30:00Z"))).toEqual({ weekday: 4, minutes: 450 });
  });
  it("bruker normaltid (UTC+1) etter omstilling 25.10", () => {
    // Mandag 26.10.2026 06:30 UTC = 07:30 norsk tid
    expect(osloClock(new Date("2026-10-26T06:30:00Z"))).toEqual({ weekday: 1, minutes: 450 });
  });
});

describe("isWithinSchedule", () => {
  const morning = [{ days: weekdays, from: "06:30", to: "09:00" }];

  it("tom liste betyr alltid", () => {
    expect(isWithinSchedule([], new Date("2026-10-18T03:00:00Z"))).toBe(true);
  });

  it("innenfor tidsrom på hverdag", () => {
    expect(isWithinSchedule(morning, new Date("2026-10-15T05:30:00Z"))).toBe(true);
  });

  it("starttid er inkludert, sluttid er ikke", () => {
    expect(isWithinSchedule(morning, new Date("2026-10-15T04:30:00Z"))).toBe(true); // 06:30
    expect(isWithinSchedule(morning, new Date("2026-10-15T07:00:00Z"))).toBe(false); // 09:00
  });

  it("utenfor på lørdag", () => {
    expect(isWithinSchedule(morning, new Date("2026-10-17T05:30:00Z"))).toBe(false);
  });

  it("følger norsk tid også etter overgang til vintertid", () => {
    // 07:30 norsk tid mandag 26.10 = 06:30 UTC; 05:30 UTC er 06:30 og også innenfor
    expect(isWithinSchedule(morning, new Date("2026-10-26T06:30:00Z"))).toBe(true);
    // 05:00 UTC = 06:00 norsk tid, utenfor
    expect(isWithinSchedule(morning, new Date("2026-10-26T05:00:00Z"))).toBe(false);
  });

  it("tidsrom over midnatt gjelder fra startdagen", () => {
    const night = [{ days: [5], from: "22:00", to: "02:00" }]; // fredag kveld
    expect(isWithinSchedule(night, new Date("2026-10-16T21:00:00Z"))).toBe(true); // fre 23:00
    expect(isWithinSchedule(night, new Date("2026-10-16T23:30:00Z"))).toBe(true); // lør 01:30
    expect(isWithinSchedule(night, new Date("2026-10-17T00:30:00Z"))).toBe(false); // lør 02:30
    expect(isWithinSchedule(night, new Date("2026-10-15T21:00:00Z"))).toBe(false); // tor 23:00
  });

  it("like tider betyr hele døgnet de valgte dagene", () => {
    const weekend = [{ days: [6, 7], from: "00:00", to: "00:00" }];
    expect(isWithinSchedule(weekend, new Date("2026-10-17T12:00:00Z"))).toBe(true);
    expect(isWithinSchedule(weekend, new Date("2026-10-16T12:00:00Z"))).toBe(false);
  });

  it("flere regler kombineres", () => {
    const rules = [...morning, { days: weekdays, from: "15:00", to: "17:30" }];
    expect(isWithinSchedule(rules, new Date("2026-10-15T14:00:00Z"))).toBe(true); // 16:00
    expect(isWithinSchedule(rules, new Date("2026-10-15T10:00:00Z"))).toBe(false); // 12:00
  });
});
