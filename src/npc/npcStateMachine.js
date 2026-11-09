export const NPC_STATES = Object.freeze([
  "SPAWNING",
  "INITIALIZING",
  "MORNING",
  "EXPLORING",
  "WORKING",
  "GATHERING",
  "EATING",
  "RETURNING_HOME",
  "SEEKING_SHELTER",
  "SLEEPING",
  "SURVIVAL_EMERGENCY",
  "RECOVERING",
  "IDLE",
]);

export class NPCStateMachine {
  constructor(initial = "SPAWNING") {
    if (!NPC_STATES.includes(initial))
      throw new Error(`Unknown NPC state: ${initial}`);
    this.state = initial;
    this.enteredAt = Date.now();
    this.lastReason = "initialization";
  }
  transition(next, reason = "routine decision") {
    if (!NPC_STATES.includes(next))
      throw new Error(`Unknown NPC state: ${next}`);
    if (next !== this.state) {
      this.state = next;
      this.enteredAt = Date.now();
      this.lastReason = reason;
    }
    return this.state;
  }
  snapshot() {
    return {
      state: this.state,
      enteredAt: this.enteredAt,
      lastReason: this.lastReason,
    };
  }
}
