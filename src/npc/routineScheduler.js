export class RoutineScheduler {
  constructor({ morning = 1000, evening = 11000, night = 13000 } = {}) { this.morning = morning; this.evening = evening; this.night = night }
  phase(timeOfDay = 0) {
    const time = ((Number(timeOfDay) % 24000) + 24000) % 24000
    if (time < this.morning) return 'NIGHT'
    if (time < this.evening) return 'DAY'
    if (time < this.night) return 'EVENING'
    return 'NIGHT'
  }
}
