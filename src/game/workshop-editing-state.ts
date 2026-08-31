export class WorkshopEditingState {
  private simulationStarted = false;

  constructor(private readonly locksAfterSimulationStarts: boolean) {}

  get editable(): boolean {
    return !this.locksAfterSimulationStarts || !this.simulationStarted;
  }

  beginSimulation(): void {
    this.simulationStarted = true;
  }

  resetSimulation(): void {
    this.simulationStarted = false;
  }
}
