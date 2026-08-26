import type { SynaraHistoryCommand } from "./SynaraHistoryTypes";
import { SynaraSessionHistory } from "./SynaraSessionHistory";

export class SynaraHistoryCommands {
  private dispatchCount = 0;

  public constructor(private readonly history: SynaraSessionHistory) {}

  public dispatch(command: SynaraHistoryCommand): boolean {
    this.dispatchCount += 1;
    return this.history.dispatch(command);
  }

  public getDispatchCount(): number {
    return this.dispatchCount;
  }
}
