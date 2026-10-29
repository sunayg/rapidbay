<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { RouterView } from "vue-router";
import { installFocus, uninstallFocus } from "./lib/focus";

onMounted(installFocus);
onBeforeUnmount(uninstallFocus);
</script>

<template>
  <RouterView />
</template>
