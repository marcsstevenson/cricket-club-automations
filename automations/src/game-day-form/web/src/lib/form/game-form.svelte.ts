import { emptyForm, type FieldErrors, type FormState } from '$shared/types';

export class GameForm {
  state = $state<FormState>(emptyForm());
  errors = $state<FieldErrors>({});
  baseVersion = $state(0);
  initialJson = '';

  constructor(public draftKey: string) {}

  reset(s: FormState, baseVersion: number) {
    this.state = JSON.parse(JSON.stringify(s));
    this.baseVersion = baseVersion;
    this.errors = {};
    this.initialJson = JSON.stringify(this.state);
  }
}
