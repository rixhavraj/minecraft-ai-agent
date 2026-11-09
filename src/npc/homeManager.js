import { memoryStore } from "../database/memory_store.js";

export class HomeManager {
  constructor({
    worldId = "unknown",
    dimension = "overworld",
    username = "Agent001",
  } = {}) {
    this.worldId = worldId;
    this.dimension = dimension;
    this.username = username;
    this.home = null;
  }
  setHome(position, name = "npc_home") {
    if (
      !position ||
      !["x", "y", "z"].every((key) => Number.isFinite(Number(position[key])))
    )
      throw new Error("Home requires numeric x, y, z coordinates");
    this.home = {
      name,
      x: Number(position.x),
      y: Number(position.y),
      z: Number(position.z),
    };
    memoryStore.recordWorldObservation({
      worldId: this.worldId,
      dimension: this.dimension,
      discoveryType: "home",
      x: this.home.x,
      y: this.home.y,
      z: this.home.z,
      details: { name, username: this.username },
    });
    return this.home;
  }
  loadHome(name = "npc_home") {
    const row = memoryStore
      .getWorldObservations({
        worldId: this.worldId,
        dimension: this.dimension,
        discoveryType: "home",
        limit: 50,
      })
      .find((item) => item.details?.name === name);
    if (!row) return null;
    this.home = { name, x: row.x, y: row.y, z: row.z };
    return this.home;
  }
  getHome() {
    return this.home;
  }
}
