import type { DamageRange, Sourced } from "../../../../sim/sourced";
import type { ThreatChange } from "../../../../sim/threat";
import type { ATile } from "../../fight/geometry";
import { V } from "./data";
import type { DangerRole, P3Row } from "./types";

function hurts(range: Sourced<DamageRange>): string {
  const { min, max } = range.value;
  return min === max ? `${min} damage` : `${min} to ${max} damage`;
}

/** What the mechanics guide says for each danger the script already shows on the floor, with the tick it lands. */
const DANGER: Readonly<Record<DangerRole, Readonly<{ what: string; todo: string }>>> = {
  bomb: { what: `Void bomb drops (${hurts(V.bombDamage)})`, todo: "Step off: it leaves a void that stays until the quadrant falls, and into phase 4" },
  debris: { what: `Spin rubble falls (${hurts(V.debrisDamage)})`, todo: "One step off: it leaves a void patch for a while" },
  slash: { what: `Shadow slash (${hurts(V.slashDamage)})`, todo: "Step out of the 3-wide band toward you" },
  "superior-slash": { what: `Insolence slash (${hurts(V.insolenceDamage)})`, todo: "Step out of the band: it leaves debris on it" },
};

/**
 * Phase 3's floor dangers as warnings. The script logs each with the tick it lands, which the danger tiles already draw, so
 * the guide reads the same looks; a withdrawn role drops every warning of that role still open.
 */
export class P3Dangers {
  private open: readonly Readonly<{ id: string; role: DangerRole; lands: number }>[] = [];

  read(row: P3Row): readonly ThreatChange<ATile>[] {
    const changes: ThreatChange<ATile>[] = [];
    this.open = this.open.filter((each) => each.lands > row.tick);
    row.events.forEach((event, index) => {
      if (event.kind !== "shown") return;
      const look = event.look;
      if (look.kind === "danger") {
        const id = `danger-${row.tick}-${index}`;
        this.open = [...this.open, { id, role: look.role, lands: look.until }];
        changes.push({ kind: "told", threat: { ...DANGER[look.role], tone: "harm", where: { kind: "tiles", tiles: look.tiles }, id, told: row.tick, lands: look.until } });
      } else if (look.kind === "danger-withdrawn") {
        for (const { id } of this.open.filter((each) => each.role === look.role)) changes.push({ kind: "dropped", id });
        this.open = this.open.filter((each) => each.role !== look.role);
      }
    });
    return changes;
  }
}
