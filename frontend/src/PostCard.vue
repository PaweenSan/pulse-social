<script setup>
import { ref, computed } from 'vue'
import Icon from './Icon.vue'
import { api } from './api.js'
import { initials, relativeTime } from './utils.js'
const props = defineProps({ post: Object, user: Object })
const emit = defineEmits(['updated', 'deleted', 'auth', 'profile'])
const error = ref(''), busy = ref(false), editing = ref(false), draft = ref(''), confirming = ref(false)
const commentsOpen = ref(false), comments = ref([]), commentsLoading = ref(false), commentDraft = ref(''), commenting = ref(false)
const deletingComment = ref('')
const own = computed(() => props.user?.id === props.post.author.id)
function startEdit() { draft.value = props.post.content; editing.value = true; error.value = '' }
async function save() {
  if (!draft.value.trim()) return
  busy.value = true; error.value = ''
  try { const { post } = await api(`/posts/${props.post.id}`, { method: 'PATCH', body: { content: draft.value.trim() } }); emit('updated', post); editing.value = false }
  catch (e) { error.value = e.message } finally { busy.value = false }
}
async function remove() {
  busy.value = true; error.value = ''
  try { await api(`/posts/${props.post.id}`, { method: 'DELETE' }); emit('deleted', props.post.id) }
  catch (e) { error.value = e.message } finally { busy.value = false; confirming.value = false }
}
async function like() {
  if (!props.user) return emit('auth')
  if (busy.value) return
  busy.value = true; error.value = ''
  try { const result = await api(`/posts/${props.post.id}/like`, { method: props.post.liked ? 'DELETE' : 'PUT' }); emit('updated', { ...props.post, ...result }) }
  catch (e) { error.value = e.message } finally { busy.value = false }
}
async function toggleComments() {
  commentsOpen.value = !commentsOpen.value
  if (!commentsOpen.value) return
  commentsLoading.value = true; error.value = ''
  try { comments.value = (await api(`/posts/${props.post.id}/comments`)).comments }
  catch (e) { error.value = e.message } finally { commentsLoading.value = false }
}
async function addComment() {
  if (!commentDraft.value.trim() || commentsLoading.value) return
  commenting.value = true; error.value = ''
  try {
    const { comment } = await api(`/posts/${props.post.id}/comments`, { method: 'POST', body: { content: commentDraft.value.trim() } })
    comments.value.push(comment); commentDraft.value = ''; emit('updated', { ...props.post, commentCount: props.post.commentCount + 1 })
  } catch (e) { error.value = e.message } finally { commenting.value = false }
}
async function removeComment(comment) {
  deletingComment.value = comment.id; error.value = ''
  try { await api(`/comments/${comment.id}`, { method: 'DELETE' }); comments.value = comments.value.filter(item => item.id !== comment.id); emit('updated', { ...props.post, commentCount: Math.max(0, props.post.commentCount - 1) }) }
  catch (e) { error.value = e.message } finally { deletingComment.value = '' }
}
</script>
<template>
  <article class="post">
    <div class="post-heading">
      <button class="avatar" :aria-label="`View ${post.author.name}'s profile`" @click="emit('profile', post.author.username)">{{ initials(post.author.name) }}</button>
      <div class="author-info"><button class="author-name" @click="emit('profile', post.author.username)">{{ post.author.name }}</button><span>@{{ post.author.username }} <span class="separator">·</span> <time :datetime="post.createdAt" :title="new Date(post.createdAt).toLocaleString()">{{ relativeTime(post.createdAt) }}</time><span v-if="post.updatedAt !== post.createdAt" class="edited"> · edited</span></span></div>
      <div v-if="own && !editing" class="post-management"><button class="icon-button" aria-label="Edit post" title="Edit post" @click="startEdit"><Icon name="edit" :size="17" /></button><button class="icon-button" aria-label="Delete post" title="Delete post" @click="confirming = !confirming"><Icon name="close" :size="18" /></button></div>
    </div>
    <form v-if="editing" class="edit-post" @submit.prevent="save"><label class="sr-only" :for="`edit-${post.id}`">Edit your post</label><textarea :id="`edit-${post.id}`" v-model="draft" required maxlength="2000" rows="4" :disabled="busy" /><div class="form-actions"><span class="character-count">{{ draft.length }}/2000</span><button type="button" class="button small secondary" :disabled="busy" @click="editing = false">Cancel</button><button class="button small" :disabled="busy || !draft.trim()">{{ busy ? 'Saving…' : 'Save changes' }}</button></div></form>
    <p v-else class="post-content">{{ post.content }}</p>
    <div v-if="confirming" class="delete-confirm"><span>Delete this post permanently?</span><button class="text-button danger" :disabled="busy" @click="remove">{{ busy ? 'Deleting…' : 'Delete' }}</button><button class="text-button" :disabled="busy" @click="confirming = false">Keep it</button></div>
    <div class="post-actions"><button :class="['post-action', { liked: post.liked }]" :aria-pressed="Boolean(post.liked)" :aria-label="`${post.liked ? 'Unlike' : 'Like'} post, ${post.likeCount} likes`" :disabled="busy" @click="like"><Icon name="heart" :size="19" /><span>{{ post.likeCount }}</span></button><button class="post-action" :aria-expanded="commentsOpen" :aria-controls="`comments-${post.id}`" @click="toggleComments"><Icon name="comment" :size="19" /><span>{{ post.commentCount }}</span><span class="comment-label">{{ post.commentCount === 1 ? 'comment' : 'comments' }}</span></button><span class="post-footnote">A little thought, shared.</span></div>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <section v-if="commentsOpen" :id="`comments-${post.id}`" class="comments" aria-label="Comments">
      <p v-if="commentsLoading" class="muted" role="status">Loading the conversation…</p>
      <p v-else-if="!comments.length" class="muted">Start the conversation. A few words go a long way.</p>
      <div v-for="comment in comments" :key="comment.id" class="comment"><button class="avatar mini" :aria-label="`View ${comment.author.name}'s profile`" @click="emit('profile', comment.author.username)">{{ initials(comment.author.name) }}</button><div class="comment-body"><div class="comment-header"><button class="author-name" @click="emit('profile', comment.author.username)">{{ comment.author.name }}</button><time :datetime="comment.createdAt">{{ relativeTime(comment.createdAt) }}</time><button v-if="user?.id === comment.author.id" class="text-button danger delete-comment" :disabled="deletingComment === comment.id" @click="removeComment(comment)">{{ deletingComment === comment.id ? 'Deleting…' : 'Delete' }}</button></div><p>{{ comment.content }}</p></div></div>
      <form v-if="user" class="comment-form" @submit.prevent="addComment"><label class="sr-only" :for="`comment-${post.id}`">Write a comment</label><textarea :id="`comment-${post.id}`" v-model="commentDraft" rows="2" maxlength="500" placeholder="Add your thoughts…" required :disabled="commenting || commentsLoading" /><div class="form-actions"><span class="character-count">{{ commentDraft.length }}/500</span><button class="button small" :disabled="commenting || commentsLoading || !commentDraft.trim()">{{ commenting ? 'Posting…' : 'Reply' }}<Icon name="arrow" :size="15" /></button></div></form>
      <button v-else class="text-button" @click="emit('auth')">Sign in to join the conversation <span aria-hidden="true">↗</span></button>
    </section>
  </article>
</template>
