<script setup lang="ts">
import {
  NButton,
  NCard,
  NCheckbox,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSpace,
} from 'naive-ui';
import { ref } from 'vue';

import { useVfCreateTask } from '../composables/useVirtualFactory.js';

const emit = defineEmits<{
  created: [id: string];
  'update:show': [value: boolean];
}>();

const props = defineProps<{
  show: boolean;
}>();

const { creating, error, create } = useVfCreateTask();

const goal = ref('');
const workUnits = ref<{ title: string; spec: string; checkpoint: boolean }[]>([]);
const tags = ref('');
const workingDir = ref('');
const gitRemote = ref('');

const validationError = ref('');

function addWu(): void {
  workUnits.value.push({ title: '', spec: '', checkpoint: false });
}

function removeWu(index: number): void {
  workUnits.value.splice(index, 1);
}

function validate(): boolean {
  validationError.value = '';
  if (!goal.value.trim()) {
    validationError.value = 'Goal is required';
    return false;
  }
  if (!workingDir.value.trim() && !gitRemote.value.trim()) {
    validationError.value = 'Provide at least one of Working Directory or Git Remote URL';
    return false;
  }
  return true;
}

async function handleSubmit(): Promise<void> {
  if (!validate()) return;
  const wus = workUnits.value
    .filter((wu) => wu.title.trim() && wu.spec.trim())
    .map((wu) => ({
      title: wu.title.trim(),
      spec: wu.spec.trim(),
      ...(wu.checkpoint ? { checkpoint: true } : {}),
    }));
  const tagList = tags.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const result = await create(
    goal.value.trim(),
    wus.length > 0 ? wus : undefined,
    tagList.length > 0 ? tagList : undefined,
    workingDir.value.trim() || undefined,
    gitRemote.value.trim() || undefined,
  );
  if (result) {
    goal.value = '';
    workUnits.value = [];
    tags.value = '';
    workingDir.value = '';
    gitRemote.value = '';
    validationError.value = '';
    emit('created', result.id);
    emit('update:show', false);
  }
}
</script>

<template>
  <NModal
    :show="show"
    @update:show="(v: boolean) => emit('update:show', v)"
    preset="card"
    title="New Task"
    style="max-width: 600px"
  >
    <NForm>
      <NFormItem label="Goal" required>
        <NInput
          v-model:value="goal"
          type="textarea"
          placeholder="Describe the task goal"
          rows="3"
        />
      </NFormItem>

      <NFormItem label="Work Units">
        <div style="width: 100%">
          <div
            v-for="(wu, i) in workUnits"
            :key="i"
            style="border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 8px; margin-bottom: 8px"
          >
            <NSpace vertical>
              <NInput v-model:value="wu.title" placeholder="Work unit title" />
              <NInput
                v-model:value="wu.spec"
                type="textarea"
                placeholder="Specification"
                rows="2"
              />
              <NSpace align="center">
                <NCheckbox v-model:checked="wu.checkpoint">Checkpoint</NCheckbox>
                <NButton size="tiny" quaternary type="error" @click="removeWu(i)">
                  Remove
                </NButton>
              </NSpace>
            </NSpace>
          </div>
          <NButton size="small" @click="addWu">+ Add Work Unit</NButton>
        </div>
      </NFormItem>

      <NFormItem label="Tags">
        <NInput v-model:value="tags" placeholder="tag1, tag2, tag3" />
      </NFormItem>

      <NCard size="tiny" style="margin-bottom: 8px">
        <template #header><span style="font-size: 0.85rem">Repository</span></template>
        <NSpace vertical>
          <NFormItem label="Working Directory (local path)">
            <NInput v-model:value="workingDir" placeholder="/path/to/repo" />
          </NFormItem>
          <NFormItem label="Git Remote URL">
            <NInput v-model:value="gitRemote" placeholder="https://github.com/user/repo.git" />
          </NFormItem>
          <span style="font-size: 0.75rem; opacity: 0.6">At least one is required. The server working directory cannot be used.</span>
        </NSpace>
      </NCard>

      <div v-if="error || validationError" style="color: #e88080; font-size: 0.85rem; margin-bottom: 8px">
        {{ validationError || error?.message }}
      </div>

      <NSpace justify="end">
        <NButton @click="emit('update:show', false)">Cancel</NButton>
        <NButton type="primary" :loading="creating" :disabled="!goal.trim()" @click="handleSubmit">
          Create Task
        </NButton>
      </NSpace>
    </NForm>
  </NModal>
</template>
