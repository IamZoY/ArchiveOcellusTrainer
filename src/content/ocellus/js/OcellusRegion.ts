import { parseLoadout } from "osrs-sdk";
import type { CatalogLoadout } from "osrs-sdk";
import type { DrillConfig, StartWeapon } from "./OcellusTimings";
import { OCELLUS_P4 } from "./OcellusTimings";
import { OCELLUS_LOADOUTS, OCELLUS_PRESETS, loadoutSnapshot, startTier } from "./OcellusLoadout";
import type { FightLog, FightSnapshot } from "./P4Types";
import { warmSpotAnim } from "./entities/P4Views";
import { EncounterRegion } from "../../../sim/sdk/EncounterRegion";
import type { P4Entry, P4Watch } from "./p4/phase";
import { p4Phase } from "./p4/phase";
import { PLATFORM_ROOM } from "./rooms/platform";

type DrillEntries = Readonly<{ p4: P4Entry }>;
type DrillPhases = Readonly<{ p4: ReturnType<typeof p4Phase<DrillEntries>> }>;

const SARADOMIN_BREW = 6685;
const DRILL_START: Readonly<Record<DrillConfig["choices"]["setup"]["key"], StartWeapon>> = { ranged: "twistedBow", melee: "melee" };

function drillLoadout(config: DrillConfig): CatalogLoadout {
  const { equipment, inventory } = OCELLUS_PRESETS.raid.loadout;
  const blowpipe = OCELLUS_P4.gear.blowpipe.value.itemId;
  const parsed = parseLoadout(OCELLUS_LOADOUTS.catalog, { equipment, inventory: inventory.map((id) => (id === blowpipe ? SARADOMIN_BREW : id)) });
  if (parsed.kind === "refused") throw new Error(`the drill loadout is refused: ${JSON.stringify(parsed.rejections)}`);
  return startTier("raid", DRILL_START[config.choices.setup.key], parsed.loadout);
}

/** Phase 4 alone on its flat platform: the in-process bed for P4's mechanic tests. The site enters phase 4 only from the full fight. */
export class OcellusRegion extends EncounterRegion<DrillEntries, DrillPhases> {
  private readonly watch: P4Watch;

  constructor(private readonly config: DrillConfig) {
    const watch: P4Watch = { invincible: false, mounted: null };
    super({ room: PLATFORM_ROOM, phases: { p4: p4Phase<DrillEntries>(watch, () => undefined) }, start: { phase: "p4", entry: { kind: "drill", config, loadout: drillLoadout(config) } }, seed: config.seed });
    this.watch = watch;
  }

  override getName(): string {
    return "Ocellus";
  }

  override async preload(): Promise<void> {
    await super.preload();
    const anchor = this.entities[0];
    if (anchor === undefined) throw new Error("the explosion spotanim warms from a unit that exists before the splash clears");
    await warmSpotAnim(anchor, OCELLUS_P4.explosion.spotAnim.value);
  }

  get invincible(): boolean {
    return this.watch.invincible;
  }

  set invincible(on: boolean) {
    this.watch.invincible = on;
  }

  snapshot(): FightSnapshot | null {
    const mounted = this.watch.mounted;
    if (mounted === null) return null;
    const { ocellus, player } = mounted;
    return {
      run: ocellus.runState(),
      boss: { npcId: OCELLUS_P4.boss.npcId.value, hp: ocellus.currentStats.hitpoint, maxHp: ocellus.stats.hitpoint, visible: ocellus.visible(), defence: ocellus.currentStats.defence },
      player: loadoutSnapshot(player),
    };
  }

  chat(): readonly string[] {
    return this.watch.mounted === null ? [] : [...this.watch.mounted.views.chat];
  }

  fightLog(): FightLog {
    const rows = this.watch.mounted === null ? [] : [...this.watch.mounted.ocellus.binding.rows];
    return { header: { seed: this.config.seed, choices: this.config.choices }, rows };
  }
}
