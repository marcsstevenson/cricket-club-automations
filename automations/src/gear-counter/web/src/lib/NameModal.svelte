<script lang="ts">
  import { me, setName } from './who.svelte';

  /** Set true to change the name; the modal also opens by itself while no name is stored. */
  let { open = $bindable(false) }: { open?: boolean } = $props();
  let dialog = $state<HTMLDialogElement>();
  let value = $state('');

  $effect(() => {
    if ((open || !me.name) && dialog && !dialog.open) {
      value = me.name;
      dialog.showModal();
    }
  });

  function save(e: SubmitEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setName(value);
    open = false;
    dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  class="modal"
  aria-labelledby="name-title"
  oncancel={(e) => {
    if (!me.name) e.preventDefault(); // can't be skipped
    else open = false;
  }}
>
  <form class="modal-body" onsubmit={save}>
    <h2 id="name-title">What's your name?</h2>
    <p class="note">It's saved on this device and shown next to the changes you make.</p>
    <label class="field" for="who">Your name</label>
    <input id="who" type="text" maxlength="40" autocomplete="name" required bind:value />
    <p><button class="btn">Save</button></p>
  </form>
</dialog>
