import type { SavedSandbox } from "../game/saved-sandboxes";

export interface SandboxInfoOptions {
  readonly sandboxes: readonly SavedSandbox[];
  readonly onBack: () => void;
  readonly onCreate: () => void;
  readonly onDuplicate: (sandboxId: string) => void;
  readonly onEdit: (sandboxId: string) => void;
  readonly onDelete: (sandboxId: string) => void;
}

function requiredDescendant<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required sandbox info element ${selector}`);
  }
  return element;
}

export class SandboxInfoView {
  private readonly sandboxList: HTMLElement;
  private readonly emptySandboxes: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly newButton: HTMLButtonElement;

  constructor(root: HTMLElement) {
    this.sandboxList = requiredDescendant(root, "#sandbox-list");
    this.emptySandboxes = requiredDescendant(root, "#empty-sandboxes");
    this.backButton = requiredDescendant(root, "#sandbox-info-back-button");
    this.newButton = requiredDescendant(root, "#new-sandbox-button");
  }

  render(options: SandboxInfoOptions): void {
    const rows = options.sandboxes.map((sandbox) => this.createSandboxRow(sandbox, options)).reverse();
    this.sandboxList.replaceChildren(...rows);
    this.emptySandboxes.hidden = rows.length !== 0;
    this.backButton.onclick = options.onBack;
    this.newButton.onclick = options.onCreate;
  }

  private createSandboxRow(
    sandbox: SavedSandbox,
    options: SandboxInfoOptions,
  ): HTMLElement {
    const row = document.createElement("article");
    row.className = "solution-row sandbox-row";
    row.setAttribute("role", "listitem");

    const identity = document.createElement("div");
    identity.className = "solution-identity";
    const name = document.createElement("strong");
    name.textContent = sandbox.name;
    const dimensions = document.createElement("small");
    dimensions.textContent = `${sandbox.width}×${sandbox.height} board`;
    identity.append(name, dimensions);

    const actions = document.createElement("div");
    actions.className = "solution-row-actions";
    actions.append(
      this.createAction("DUPLICATE", `Duplicate ${sandbox.name}`, () => {
        options.onDuplicate(sandbox.id);
      }),
      this.createAction("EDIT", `Edit ${sandbox.name}`, () => {
        options.onEdit(sandbox.id);
      }, "solution-primary-action"),
      this.createAction("DELETE", `Delete ${sandbox.name}`, () => {
        options.onDelete(sandbox.id);
      }, "solution-delete-action"),
    );

    row.append(identity, actions);
    return row;
  }

  private createAction(
    label: string,
    accessibleLabel: string,
    onClick: () => void,
    className?: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.ariaLabel = accessibleLabel;
    if (className !== undefined) {
      button.className = className;
    }
    button.addEventListener("click", onClick);
    return button;
  }
}
