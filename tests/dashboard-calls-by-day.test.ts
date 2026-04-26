import { describe, it, expect } from "vitest";
import { buildDashboardViewModel } from "@/lib/viewmodels/dashboardViewModel";
import type { TrackingCompany } from "@/lib/viewmodels/trackingViewModel";

function company(over: Partial<TrackingCompany>): TrackingCompany {
  const todayIso = new Date().toISOString();
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    name: null,
    territory: [],
    callStatus: null,
    callStatusUpdatedAt: null,
    industry: null,
    updatedAt: null,
    address: null,
    ownerName: null,
    companyNumber: null,
    followUpNumber: null,
    notes: null,
    caller: null,
    createdAt: todayIso,
    ...over,
  };
}

describe("buildCallsByDay — only counts records actually called", () => {
  it("excludes records still at the default 'Not called yet'", () => {
    const data = buildDashboardViewModel(
      [
        company({ caller: "Alice", callStatus: "Not called yet" }),
        company({ caller: "Alice", callStatus: "Connected" }),
        company({ caller: "Bob", callStatus: "Not called yet" }),
        company({ caller: "Bob", callStatus: "Voicemail" }),
        company({ caller: "Bob", callStatus: "No answer" }),
      ],
      "today",
    );
    // Only the records with a real outcome should be counted.
    expect(data.callsByDay).toHaveLength(1);
    expect(data.callsByDay[0].total).toBe(3);
    expect(data.callsByDay[0]["Alice"]).toBe(1);
    expect(data.callsByDay[0]["Bob"]).toBe(2);
    // callerNames is only the reps with at least one real call.
    expect(data.callerNames).toEqual(expect.arrayContaining(["Alice", "Bob"]));
  });

  it("excludes records with no callStatus at all (legacy / pre-call)", () => {
    const data = buildDashboardViewModel(
      [
        company({ caller: "Alice", callStatus: null }),
        company({ caller: "Alice", callStatus: "Connected" }),
      ],
      "today",
    );
    expect(data.callsByDay[0].total).toBe(1);
    expect(data.callsByDay[0]["Alice"]).toBe(1);
  });

  it("requires a caller to attribute the row (no caller → no chart row)", () => {
    const data = buildDashboardViewModel(
      [
        company({ caller: null, callStatus: "Connected" }),
        company({ caller: "Alice", callStatus: "Connected" }),
      ],
      "today",
    );
    expect(data.callsByDay[0].total).toBe(1);
    expect(data.callsByDay[0]["Alice"]).toBe(1);
  });

  it("produces zero callsByDay rows when no real calls have happened", () => {
    const data = buildDashboardViewModel(
      [
        company({ caller: "Alice", callStatus: "Not called yet" }),
        company({ caller: "Bob", callStatus: "Not called yet" }),
      ],
      "today",
    );
    expect(data.callsByDay[0].total).toBe(0);
    expect(data.callerNames).toEqual([]);
  });
});

describe("buildSankey — also excludes 'Not called yet'", () => {
  it("only routes real outcomes through the Called node", () => {
    const data = buildDashboardViewModel(
      [
        company({ callStatus: "Not called yet" }),
        company({ callStatus: "Not called yet" }),
        company({ callStatus: "Connected" }),
        company({ callStatus: "Voicemail" }),
      ],
      "all",
    );
    const targets = data.sankey.nodes.map((n) => n.name);
    expect(targets).toContain("Called");
    expect(targets).toContain("Connected");
    expect(targets).toContain("Voicemail");
    expect(targets).not.toContain("Not called yet");
    const totalLinkValue = data.sankey.links.reduce((s, l) => s + l.value, 0);
    expect(totalLinkValue).toBe(2); // only the two real outcomes
  });
});
