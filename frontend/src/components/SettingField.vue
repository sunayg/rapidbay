<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CodecPreset, FieldInfo } from "../types";

const props = defineProps<{ field: FieldInfo; modelValue: unknown; error?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: unknown]; reset: []; clear: [] }>();

const CODECS = ["libx264", "libx265", "copy"];
const PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"];

const isList = computed(() => ["str_list", "int_list", "host_port_list", "regex_list"].includes(props.field.kind));
const canClear = computed(() => props.field.secret || props.field.nullable || ["str", "url"].includes(props.field.kind));

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

const text = ref(isList.value ? ((props.modelValue as string[]) ?? []).join("\n") : "");
watch(
  () => props.modelValue,
  (v) => {
    if (isList.value && JSON.stringify(v) !== JSON.stringify(parseLines(text.value))) {
      text.value = ((v as string[]) ?? []).join("\n");
    }
  },
);

function onText(event: Event) {
  text.value = (event.target as HTMLTextAreaElement).value;
  emit("update:modelValue", parseLines(text.value));
}

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}

function onNumber(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  emit("update:modelValue", raw === "" ? null : Number(raw));
}

const codec = computed(() => (props.modelValue as CodecPreset | null) ?? null);

function setCodec(event: Event) {
  const next = (event.target as HTMLSelectElement).value;
  emit("update:modelValue", { codec: next, preset: next === "copy" ? null : (codec.value?.preset ?? "ultrafast") });
}

function setPreset(event: Event) {
  emit("update:modelValue", { codec: codec.value?.codec ?? "libx264", preset: (event.target as HTMLSelectElement).value });
}

const id = computed(() => `field-${props.field.key}`);
</script>

<template>
  <div class="field" :class="{ invalid: !!error }">
    <div class="field-head">
      <label :for="id">{{ field.label }}</label>
      <span class="badge" :class="field.source">{{ field.source }}</span>
      <span v-if="field.restart_needed" class="badge restart">restart needed</span>
      <span v-if="field.pending_restart" class="badge pending">pending restart</span>
      <span v-if="field.secret" class="badge" :class="field.is_set ? 'set' : 'unset'">{{ field.is_set ? "set" : "not set" }}</span>
    </div>

    <input v-if="field.kind === 'bool'" :id="id" type="checkbox" :checked="modelValue === true" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" />
    <input v-else-if="field.kind === 'int'" :id="id" type="number" :min="field.min ?? undefined" :max="field.max ?? undefined" :value="modelValue ?? ''" @input="onNumber" />
    <textarea v-else-if="isList" :id="id" rows="4" :value="text" @input="onText"></textarea>
    <div v-else-if="field.kind === 'codec_preset'" class="codec">
      <select :id="id" :value="codec?.codec ?? ''" @change="setCodec">
        <option v-if="!codec" value="" disabled>custom value from environment</option>
        <option v-for="c in CODECS" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-if="codec && codec.codec !== 'copy'" aria-label="Preset" :value="codec.preset ?? 'ultrafast'" @change="setPreset">
        <option v-for="p in PRESETS" :key="p" :value="p">{{ p }}</option>
      </select>
      <span v-if="!codec" class="hint">Using a custom value from the environment. Choose a codec to replace it.</span>
    </div>
    <input
      v-else
      :id="id"
      :type="field.secret ? 'password' : 'text'"
      :autocomplete="field.secret ? 'new-password' : 'off'"
      :placeholder="field.secret ? 'leave blank to keep' : ''"
      :value="modelValue ?? ''"
      @input="onInput"
    />

    <p v-if="field.help" class="hint">{{ field.help }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="field-actions">
      <button v-if="field.source === 'saved'" type="button" class="link" @click="emit('reset')">Reset</button>
      <button v-if="canClear" type="button" class="link" @click="emit('clear')">Clear</button>
    </div>
  </div>
</template>
