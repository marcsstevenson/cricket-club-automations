<script lang="ts">
  import FieldError from './FieldError.svelte';

  let {
    value = $bindable(),
    id,
    label,
    maxDigits = 3,
    readonly = false,
    error,
    onedit,
  }: { value: number | null; id: string; label: string; maxDigits?: number; readonly?: boolean; error?: string; onedit?: () => void } = $props();
</script>

<label class="field" for={id}>{label}</label>
<input
  {id}
  type="text"
  inputmode="numeric"
  autocomplete="off"
  {readonly}
  value={value ?? ''}
  aria-invalid={!!error}
  oninput={(e) => {
    const digits = e.currentTarget.value.replace(/\D/g, '').slice(0, maxDigits);
    e.currentTarget.value = digits;
    value = digits === '' ? null : Number(digits);
    onedit?.();
  }}
/>
<FieldError msg={error} />
