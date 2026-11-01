/**
 * What this client has thrown at the boss, and what it tells the room about it.
 *
 * The engine holds a hit in the air for a tick or more before it lands, and that gap is the room's whole chance:
 * said while it is still flying, the same hit can be made to land on the same tick on every machine, so the party
 * wears down one boss rather than each client killing a boss of its own that happens to look the same.
 */
import type { Projectile, Unit } from "osrs-sdk";
import type { Blow } from "./protocol";
import { keptBlows, parseBlowStyle } from "./protocol";

export class BlowBook {
  /**
   * The hits already written down, by identity: the engine hands back the same objects every tick, and a hit read
   * twice would be a hit the whole party's boss took twice.
   */
  private readonly seen = new WeakSet<Projectile>();
  private count = 0;
  private blows: readonly Blow[] = [];

  /**
   * Reads the boss for hits this player has in the air, and says what the next report should carry: everything
   * still flying, and the last couple of ticks of landed ones in case a report was lost on the way.
   *
   * `at` is the tick this client has just finished, which is where the landing tick is counted from: a hit with two
   * ticks of delay left lands two ticks from here, and that is a tick number every client in the room agrees on.
   */
  read(boss: Unit, by: Unit, at: number): readonly Blow[] {
    for (const shot of boss.incomingProjectiles) {
      // Someone else's relayed hit, and the boss's own healing, are not this player's to report.
      if (this.seen.has(shot) || shot.from !== by || shot.damage < 0) continue;
      this.seen.add(shot);
      this.count += 1;
      this.blows = [...this.blows, { seq: this.count, landsAt: at + shot.remainingDelay, flight: shot.totalDelay, damage: shot.damage, style: parseBlowStyle(shot.attackStyle) }];
    }
    this.blows = keptBlows(this.blows, at);
    return this.blows;
  }
}
