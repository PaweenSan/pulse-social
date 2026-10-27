<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import PostCard from './PostCard.vue'
import { api, hasToken, setToken } from './api.js'
import { initials, safeWebsite } from './utils.js'
import { preparePhoto } from './photo.js'
const user = ref(null), sessionLoading = ref(hasToken()), route = ref(window.location.hash || '#/feed')
const posts = ref([]), nextCursor = ref(null), loading = ref(false), loadingMore = ref(false), error = ref(''), notice = ref('')
const searchText = ref(''), searchQuery = ref(''), composer = ref(''), posting = ref(false), composerError = ref(''), composerField = ref(null)
const photo = ref(null), photoProcessing = ref(false), photoInput = ref(null)
const profile = ref(null), profilePosts = ref([]), profileLoading = ref(false), profileError = ref(''), profileEditing = ref(false), profileBusy = ref(false)
const profileForm = ref({ name: '', bio: '', website: '' })
const auth = ref({ name: '', username: '', email: '', password: '' }), authBusy = ref(false), authError = ref('')
const routeKind = computed(() => route.value.startsWith('#/u/') ? 'profile' : route.value === '#/join' ? 'join' : route.value === '#/login' ? 'login' : 'feed')
const isAuth = computed(() => ['join', 'login'].includes(routeKind.value))
const ownProfile = computed(() => user.value && profile.value?.id === user.value.id)
const pageTitle = computed(() => routeKind.value === 'profile' ? 'People of Pulse' : isAuth.value ? 'Your next conversation starts here.' : 'The everyday, connected.')
let feedRequest = 0, profileRequest = 0, photoRequest = 0
function go(path) {
  const hash = `#/${path}`
  if (window.location.hash === hash) return
  window.location.hash = hash
  onRoute()
}
function skipToContent() { document.getElementById('main-content')?.focus() }
function openProfile(username) { go(`u/${encodeURIComponent(username)}`) }
function onRoute() { route.value = window.location.hash || '#/feed'; window.scrollTo({ top: 0, behavior: 'instant' }) }
function sessionExpired() { clearPhoto(); user.value = null; notice.value = 'Your session ended. Sign in again to keep sharing.'; posts.value = posts.value.map(post => ({ ...post, liked: false })); profilePosts.value = profilePosts.value.map(post => ({ ...post, liked: false })) }
async function loadFeed(more = false) {
  if (more && (!nextCursor.value || loadingMore.value)) return
  const request = ++feedRequest
  if (more) loadingMore.value = true
  else { loading.value = true; posts.value = []; nextCursor.value = null }
  error.value = ''
  const params = new URLSearchParams()
  if (more) params.set('cursor', nextCursor.value)
  if (searchQuery.value) params.set('q', searchQuery.value)
  try {
    const result = await api(`/posts${params.size ? `?${params}` : ''}`)
    if (request !== feedRequest) return
    const combined = more ? [...posts.value, ...result.posts] : result.posts
    posts.value = combined.filter((post, index) => combined.findIndex(item => item.id === post.id) === index)
    nextCursor.value = result.nextCursor
  } catch (e) { if (request === feedRequest) error.value = e.message }
  finally { if (request === feedRequest) { loading.value = false; loadingMore.value = false } }
}
async function loadProfile() {
  const request = ++profileRequest
  profileLoading.value = true; profileError.value = ''; profile.value = null; profilePosts.value = []; profileEditing.value = false
  let username
  try { username = decodeURIComponent(route.value.slice(4)) } catch { username = '' }
  try {
    if (!username) throw new Error('This profile address is not valid.')
    const result = await api(`/users/${encodeURIComponent(username)}`)
    if (request !== profileRequest) return
    profile.value = result.user; profilePosts.value = result.posts
  } catch (e) { if (request === profileRequest) profileError.value = e.message }
  finally { if (request === profileRequest) profileLoading.value = false }
}
function search() {
  searchQuery.value = searchText.value.trim()
  if (routeKind.value !== 'feed') go('feed')
  else loadFeed()
}
function clearSearch() { searchText.value = ''; searchQuery.value = ''; loadFeed() }
async function focusComposer() {
  if (!user.value) return go('join')
  go('feed'); await nextTick(); composerField.value?.focus(); composerField.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function clearPhoto() {
  photoRequest++
  if (photo.value?.url) URL.revokeObjectURL(photo.value.url)
  photo.value = null; photoProcessing.value = false
  if (photoInput.value) photoInput.value.value = ''
}
async function choosePhoto(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || posting.value) return
  clearPhoto()
  const request = photoRequest
  photoProcessing.value = true; composerError.value = ''
  try {
    const result = await preparePhoto(file)
    if (request !== photoRequest) return
    photo.value = { image: result.image, url: URL.createObjectURL(result.blob) }
  } catch (e) { if (request === photoRequest) composerError.value = e.message }
  finally { if (request === photoRequest) photoProcessing.value = false }
}
async function publish() {
  if (posting.value || photoProcessing.value || (!composer.value.trim() && !photo.value)) return
  posting.value = true; composerError.value = ''
  try {
    const { post } = await api('/posts', { method: 'POST', body: { content: composer.value.trim(), ...(photo.value ? { image: photo.value.image } : {}) } })
    composer.value = ''; clearPhoto(); notice.value = 'Your thought is out in the world.'
    if (searchQuery.value) { searchText.value = ''; searchQuery.value = ''; await loadFeed() }
    else posts.value.unshift(post)
    user.value = { ...user.value, postCount: (user.value.postCount || 0) + 1 }
  } catch (e) { composerError.value = e.message } finally { posting.value = false }
}
function updatePost(post) { posts.value = posts.value.map(item => item.id === post.id ? post : item); profilePosts.value = profilePosts.value.map(item => item.id === post.id ? post : item) }
function deletePost(id) {
  posts.value = posts.value.filter(post => post.id !== id); profilePosts.value = profilePosts.value.filter(post => post.id !== id)
  if (user.value) user.value = { ...user.value, postCount: Math.max(0, (user.value.postCount || 0) - 1) }
  if (ownProfile.value) profile.value = { ...profile.value, postCount: Math.max(0, (profile.value.postCount || 0) - 1) }
  notice.value = 'Post deleted.'
}
async function submitAuth() {
  authBusy.value = true; authError.value = ''
  try {
    const registering = routeKind.value === 'join'
    const body = registering ? { ...auth.value } : { email: auth.value.email, password: auth.value.password }
    const result = await api(`/auth/${registering ? 'register' : 'login'}`, { method: 'POST', body })
    setToken(result.token); user.value = result.user; auth.value.password = ''; notice.value = registering ? 'You’re in. Make yourself at home.' : `Welcome back, ${result.user.name}.`; go('feed')
  } catch (e) { authError.value = e.message } finally { authBusy.value = false }
}
async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); notice.value = 'You’re signed out. See you around.' }
  catch { notice.value = 'Signed out on this browser. Your server session will expire automatically.' }
  setToken(''); user.value = null; composer.value = ''; clearPhoto(); go('feed'); await loadFeed()
}
function editProfile() { profileForm.value = { name: profile.value.name, bio: profile.value.bio || '', website: profile.value.website || '' }; profileEditing.value = true; profileError.value = '' }
async function saveProfile() {
  profileBusy.value = true; profileError.value = ''
  try {
    const { user: updated } = await api('/me', { method: 'PATCH', body: { name: profileForm.value.name.trim(), bio: profileForm.value.bio.trim(), website: profileForm.value.website.trim() } })
    user.value = updated; profile.value = updated; profileEditing.value = false; notice.value = 'Profile updated.'
    profilePosts.value = profilePosts.value.map(post => ({ ...post, author: { ...post.author, name: updated.name } }))
  } catch (e) { profileError.value = e.message } finally { profileBusy.value = false }
}
watch(route, () => { authError.value = ''; if (routeKind.value === 'profile') loadProfile(); else if (routeKind.value === 'feed') loadFeed() }, { immediate: true })
onMounted(async () => {
  window.addEventListener('hashchange', onRoute); window.addEventListener('pulse:session-expired', sessionExpired)
  if (hasToken()) { try { user.value = (await api('/auth/me')).user } catch (e) { if (hasToken()) notice.value = e.message } finally { sessionLoading.value = false } }
})
onUnmounted(() => { clearPhoto(); window.removeEventListener('hashchange', onRoute); window.removeEventListener('pulse:session-expired', sessionExpired) })
</script>
<template>
  <a class="skip-link" href="#main-content" @click.prevent="skipToContent">Skip to content</a>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Main navigation">
      <a class="brand" href="#/feed" aria-label="Pulse home"><span class="brand-mark"><Icon name="pulse" :size="28" /></span><span>pulse<span class="brand-dot">.</span></span></a>
      <div class="sidebar-topline">A LITTLE MORE CONNECTED</div>
      <nav class="navigation"><a href="#/feed" :class="{ active: routeKind === 'feed' }" :aria-current="routeKind === 'feed' ? 'page' : undefined"><Icon name="home" /><span>Community feed</span><span class="nav-dot" /></a><a v-if="user" :href="`#/u/${encodeURIComponent(user.username)}`" :class="{ active: ownProfile && routeKind === 'profile' }" :aria-current="ownProfile && routeKind === 'profile' ? 'page' : undefined"><Icon name="user" /><span>My profile</span></a><a v-else href="#/login" :class="{ active: routeKind === 'login' }"><Icon name="user" /><span>Sign in</span></a><button v-if="user" class="icon-button mobile-signout" aria-label="Sign out" title="Sign out" @click="logout"><Icon name="logout" :size="17" /></button></nav>
      <button class="button new-post" @click="focusComposer"><Icon name="plus" /><span>Share a thought</span></button>
      <div class="sidebar-note"><Icon name="spark" :size="28" /><p>Good things happen<br />when we connect.</p><span>Less noise. More you.</span></div>
      <div class="sidebar-bottom"><template v-if="user"><button class="account" @click="openProfile(user.username)"><span class="avatar">{{ initials(user.name) }}</span><span><strong>{{ user.name }}</strong><small>@{{ user.username }}</small></span></button><button class="icon-button signout" aria-label="Sign out" title="Sign out" @click="logout"><Icon name="logout" /></button></template><template v-else><span class="small-pulse">PULSE SOCIAL</span><span class="sidebar-edition">A space for real connection.</span></template></div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><span class="topbar-label"><span class="live-dot" /> YOUR CORNER OF THE INTERNET</span><span class="topbar-right">Make a little room for connection <Icon name="sun" :size="17" /></span></header>
      <main id="main-content" tabindex="-1">
        <div class="page-heading"><div><p class="eyebrow">{{ isAuth ? 'WELCOME TO PULSE' : routeKind === 'profile' ? 'A FACE BEHIND THE THOUGHTS' : 'THE COMMUNITY FEED' }}</p><h1>{{ pageTitle }}</h1><p class="heading-description">{{ isAuth ? 'A place for your thoughts, your people, and everything in between.' : routeKind === 'profile' ? 'Everyone has a story. Here’s a little of this one.' : 'Fresh thoughts. Familiar faces. Something worth sharing.' }}</p></div><div class="heading-symbol" aria-hidden="true"><Icon name="spark" :size="46" /></div></div>
        <div v-if="notice" class="notice" role="status"><Icon name="check" :size="18" /><span>{{ notice }}</span><button class="icon-button" aria-label="Dismiss notification" @click="notice = ''"><Icon name="close" :size="16" /></button></div>
        <div class="content-grid">
          <section v-if="isAuth" class="auth-panel">
            <div class="auth-heading"><span class="eyebrow">{{ routeKind === 'join' ? 'FIND YOUR PEOPLE' : 'PICK UP WHERE YOU LEFT OFF' }}</span><h2>{{ routeKind === 'join' ? 'Let’s make an introduction.' : 'Good to have you back.' }}</h2><p>{{ routeKind === 'join' ? 'A few details, and you’re part of the conversation.' : 'Sign in to share what’s on your mind.' }}</p></div>
            <form class="stack-form" @submit.prevent="submitAuth"><template v-if="routeKind === 'join'"><label>Your name<input v-model="auth.name" name="name" autocomplete="name" maxlength="60" required placeholder="How should we call you?" :disabled="authBusy" /></label><label>Username<span class="input-prefix"><span>@</span><input v-model="auth.username" name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]{3,24}" required placeholder="yourname" :disabled="authBusy" /></span><small>3–24 letters, numbers, or underscores.</small></label></template><label>Email address<input v-model="auth.email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" :disabled="authBusy" /></label><label>Password<input v-model="auth.password" name="password" type="password" :autocomplete="routeKind === 'join' ? 'new-password' : 'current-password'" :minlength="routeKind === 'join' ? 8 : undefined" maxlength="128" required :placeholder="routeKind === 'join' ? 'At least 8 characters' : 'Your password'" :disabled="authBusy" /></label><p v-if="authError" class="error-message" role="alert">{{ authError }}</p><button class="button" :disabled="authBusy">{{ authBusy ? 'One moment…' : routeKind === 'join' ? 'Create my account' : 'Sign in' }}<Icon name="arrow" :size="18" /></button></form>
            <p class="auth-switch">{{ routeKind === 'join' ? 'Already part of Pulse?' : 'New around here?' }} <a :href="routeKind === 'join' ? '#/login' : '#/join'">{{ routeKind === 'join' ? 'Sign in' : 'Join the community' }}</a></p><a class="back-link" href="#/feed">← Take a look around first</a>
          </section>
          <section v-else class="feed-column" :aria-label="routeKind === 'profile' ? 'Profile and posts' : 'Community feed'">
            <template v-if="routeKind === 'profile'">
              <div v-if="profileLoading" class="loading-state" role="status"><span class="loading-line" />Getting to know them…</div>
              <section v-if="profile" class="profile-panel"><div class="profile-banner"><span>EVERY PERSON. A DIFFERENT PERSPECTIVE.</span><Icon name="pulse" :size="100" /></div><div class="profile-details"><div class="profile-top"><span class="avatar large">{{ initials(profile.name) }}</span><button v-if="ownProfile && !profileEditing" class="button secondary small" @click="editProfile"><Icon name="edit" :size="15" />Edit profile</button></div><h2>{{ profile.name }}</h2><p class="profile-handle">@{{ profile.username }}</p><p v-if="profile.bio" class="profile-bio">{{ profile.bio }}</p><p v-else class="muted profile-bio">A story still being written.</p><a v-if="safeWebsite(profile.website)" class="website-link" :href="safeWebsite(profile.website)" target="_blank" rel="noopener noreferrer"><Icon name="globe" :size="15" />{{ profile.website }}</a><div class="profile-meta"><span><strong>{{ profile.postCount ?? profilePosts.length }}</strong> {{ (profile.postCount ?? profilePosts.length) === 1 ? 'thought shared' : 'thoughts shared' }}</span><span>Joined {{ new Date(profile.createdAt).toLocaleDateString('en', { month: 'long', year: 'numeric' }) }}</span></div>
                <form v-if="profileEditing" class="stack-form profile-edit" @submit.prevent="saveProfile"><label>Name<input v-model="profileForm.name" autocomplete="name" required maxlength="60" :disabled="profileBusy" /></label><label>A little about you<textarea v-model="profileForm.bio" maxlength="180" rows="3" placeholder="What makes you, you?" :disabled="profileBusy" /><small>{{ profileForm.bio.length }}/180</small></label><label>Website<input v-model="profileForm.website" type="url" maxlength="200" placeholder="https://your-corner.com" :disabled="profileBusy" /></label><div class="form-actions"><button class="button secondary small" type="button" :disabled="profileBusy" @click="profileEditing = false">Cancel</button><button class="button small" :disabled="profileBusy">{{ profileBusy ? 'Saving…' : 'Save profile' }}</button></div></form>
              </div></section>
              <div v-if="profile" class="feed-toolbar"><h2>From {{ ownProfile ? 'your' : 'their' }} corner</h2><span>{{ profilePosts.length }} {{ profilePosts.length === 1 ? 'post' : 'posts' }}</span></div>
              <p v-if="profileError" class="error-message padded" role="alert">{{ profileError }}</p>
              <div v-if="!profileLoading && !profile && profileError" class="empty-state compact"><h2>A missing connection.</h2><p>This profile couldn’t be opened. Check the address or try again.</p><button class="button secondary small" @click="loadProfile">Try again</button></div>
              <PostCard v-for="post in profilePosts" :key="post.id" :post="post" :user="user" @updated="updatePost" @deleted="deletePost" @auth="go('login')" @profile="openProfile" />
              <div v-if="profile && !profilePosts.length" class="empty-state compact"><Icon name="comment" :size="30" /><h2>{{ ownProfile ? 'Your story starts here.' : 'A quiet corner, for now.' }}</h2><p>{{ ownProfile ? 'Share a first thought with the community.' : 'Their first thought is still on its way.' }}</p><button v-if="ownProfile" class="button small" @click="focusComposer">Write a post<Icon name="arrow" :size="17" /></button></div>
            </template>
            <template v-else>
              <form v-if="user" class="composer" @submit.prevent="publish"><div class="composer-main"><span class="avatar">{{ initials(user.name) }}</span><label class="sr-only" for="new-post">What’s on your mind?</label><textarea id="new-post" ref="composerField" v-model="composer" maxlength="2000" rows="3" :disabled="posting" :placeholder="`What’s on your mind, ${user.name.split(' ')[0]}?`" /></div><div v-if="photo || photoProcessing" class="photo-preview"><img v-if="photo" :src="photo.url" alt="Selected photo ready to share" /><p v-else class="photo-progress" role="status"><span class="loading-line" />Getting your photo ready…</p><button type="button" class="remove-photo" :disabled="posting" :aria-label="photoProcessing ? 'Cancel photo preparation' : 'Remove selected photo'" @click="clearPhoto"><Icon name="close" :size="17" /></button></div><div class="composer-footer"><div class="composer-tools"><input ref="photoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden :disabled="posting" @change="choosePhoto" /><button type="button" class="attach-photo" :disabled="posting" @click="photoInput?.click()"><Icon name="photo" :size="17" />{{ photo || photoProcessing ? 'Change photo' : 'Add photo' }}</button><span class="composer-visibility"><Icon name="globe" :size="13" />Visible to everyone<span v-if="composer.length"> · {{ composer.length }}/2000</span></span></div><button class="button small" :disabled="posting || photoProcessing || (!composer.trim() && !photo)">{{ posting ? 'Sharing…' : 'Share thought' }}<Icon name="arrow" :size="17" /></button></div><p v-if="composerError" class="error-message" role="alert">{{ composerError }}</p></form>
              <div v-else class="guest-composer"><span class="avatar guest-avatar"><Icon name="plus" :size="23" /></span><div><h2>{{ sessionLoading ? 'Finding your corner…' : 'Your voice belongs here.' }}</h2><p>Something on your mind? Let it out.</p></div><a v-if="!sessionLoading" class="button small" href="#/join">Join Pulse<Icon name="arrow" :size="17" /></a></div>
              <div class="feed-toolbar"><div class="feed-tabs"><span class="selected-tab">{{ searchQuery ? 'Search results' : 'The latest' }}<span class="tiny-dot" /></span></div><span class="feed-sort"><Icon name="sun" :size="15" />Fresh perspectives</span></div>
              <div v-if="searchQuery" class="search-summary"><span>Thoughts matching “{{ searchQuery }}”</span><button class="text-button" @click="clearSearch">Clear search<Icon name="close" :size="14" /></button></div>
              <div v-if="loading" class="loading-state" role="status"><span class="loading-line" />A few fresh thoughts on their way…</div>
              <div v-if="error" class="feed-error" role="alert"><h2>We lost the connection.</h2><p>{{ error }}</p><button class="button secondary small" @click="loadFeed()">Try again<Icon name="arrow" :size="16" /></button></div>
              <PostCard v-for="post in posts" :key="post.id" :post="post" :user="user" @updated="updatePost" @deleted="deletePost" @auth="go('login')" @profile="openProfile" />
              <div v-if="!loading && !error && !posts.length" class="empty-state"><div class="empty-art" aria-hidden="true"><span class="orbit orbit-one" /><span class="orbit orbit-two" /><span class="empty-art-core"><Icon :name="searchQuery ? 'search' : 'pulse'" :size="42" /></span><span class="art-spark">✳</span><span class="art-dot" /></div><p class="eyebrow">{{ searchQuery ? 'KEEP EXPLORING' : 'EVERY COMMUNITY STARTS SOMEWHERE' }}</p><h2>{{ searchQuery ? 'A thought yet to be found.' : 'Be the first little spark.' }}</h2><p>{{ searchQuery ? 'Try another word. A different perspective might be just around the corner.' : 'An idea. A small win. Something that made you smile. The first conversation could start with you.' }}</p><button v-if="searchQuery" class="button secondary small" @click="clearSearch">Back to the feed<Icon name="arrow" :size="17" /></button><button v-else class="button small" @click="focusComposer">{{ user ? 'Share your first thought' : 'Make yourself at home' }}<Icon name="arrow" :size="17" /></button></div>
              <div v-if="nextCursor && !loading" class="load-more"><button class="button secondary small" :disabled="loadingMore" @click="loadFeed(true)">{{ loadingMore ? 'Finding more…' : 'A little more, please' }}<Icon name="arrow" :size="16" /></button></div>
              <div v-else-if="posts.length && !loading" class="feed-end"><Icon name="check" :size="17" /><span>You’re all caught up. Go make a little story.</span></div>
            </template>
          </section>
          <aside class="right-column" aria-label="Discover Pulse">
            <form class="search-box" role="search" @submit.prevent="search"><label class="sr-only" for="search">Search community posts</label><Icon name="search" :size="19" /><input id="search" v-model="searchText" type="search" maxlength="100" placeholder="Find a thought…" /><button type="submit" class="icon-button" aria-label="Search posts"><Icon name="arrow" :size="17" /></button></form>
            <section class="community-card"><div class="community-card-top"><span class="eyebrow">THIS IS PULSE</span><span class="tiny-dot" /></div><h2>Big ideas.<br />Small moments.<br /><em>Real people.</em></h2><p>A little space to share what matters to you. Pull up a chair. Stay a while.</p><div class="community-art" aria-hidden="true"><span class="art-circle">p.</span><span class="art-checker" /><span class="art-flower">✳</span></div><a v-if="!user" class="community-cta" href="#/join">Find your people<Icon name="arrow" :size="19" /></a><button v-else class="community-cta" @click="focusComposer">Put a thought out there<Icon name="arrow" :size="19" /></button></section>
            <section class="community-guidelines"><span class="eyebrow">A GOOD PLACE, TOGETHER</span><div><span class="guideline-number">01</span><p><strong>Bring your whole self.</strong><span>The everyday is worth sharing.</span></p></div><div><span class="guideline-number">02</span><p><strong>Keep it kind.</strong><span>There’s a person on the other side.</span></p></div><div><span class="guideline-number">03</span><p><strong>Stay a little curious.</strong><span>Good conversations start there.</span></p></div></section>
            <footer class="site-footer"><a href="#/feed" class="footer-brand">pulse.</a><p>A little more connected.</p><span>BUILT FOR THE WAY WE CONNECT.</span></footer>
          </aside>
        </div>
      </main>
    </div>
  </div>
</template>
