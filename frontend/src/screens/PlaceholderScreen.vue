<script setup lang="ts">
defineProps<{ screen: string; params?: Record<string, string | undefined> }>();
</script>

<template>
  <main class="placeholder" :data-screen="screen">
    <h1>{{ screen }}</h1>
    <p>This screen has not been ported yet.</p>
    <p><a href="/settings">Settings</a></p>
  </main>
</template>
