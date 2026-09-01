export interface WorkshopInformation {
  readonly name: string;
  readonly description: string;
  readonly goal: string | null;
}

export class WorkshopInfoDialog {
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly goalPanel: HTMLElement;
  private readonly goal: HTMLElement;

  constructor(private readonly dialog: HTMLDialogElement) {
    this.title = requiredDescendant(dialog, "[data-workshop-info-title]");
    this.description = requiredDescendant(dialog, "[data-workshop-info-description]");
    this.goalPanel = requiredDescendant(dialog, "[data-workshop-info-goal-panel]");
    this.goal = requiredDescendant(dialog, "[data-workshop-info-goal]");
  }

  show(information: WorkshopInformation): void {
    this.title.textContent = information.name;
    this.description.textContent = information.description;
    this.goalPanel.hidden = information.goal === null;
    this.goal.textContent = information.goal ?? "";
    this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) {
      this.dialog.close();
    }
  }
}

function requiredDescendant<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required workshop information element ${selector}`);
  }
  return element;
}
