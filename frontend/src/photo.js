import { MAX_IMAGE_BYTES, photoDimensions, validatePhotoFile } from './utils.js'
async function decodePhoto(file) {
  try {
    if (typeof createImageBitmap === 'function') return await createImageBitmap(file, { imageOrientation: 'from-image' })
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      return image
    } finally { URL.revokeObjectURL(url) }
  } catch { throw new Error('This photo could not be opened. Choose another JPG, PNG, or WebP file.') }
}
const encodePhoto = (canvas, quality) => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('This photo could not be prepared. Try another photo.')), 'image/jpeg', quality))
function base64Photo(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1))
    reader.onerror = () => reject(new Error('This photo could not be read. Try selecting it again.'))
    reader.readAsDataURL(blob)
  })
}
export async function preparePhoto(file) {
  validatePhotoFile(file)
  const source = await decodePhoto(file)
  const canvas = document.createElement('canvas')
  try {
    const dimensions = photoDimensions(source.width || source.naturalWidth, source.height || source.naturalHeight)
    canvas.width = dimensions.width; canvas.height = dimensions.height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Your browser could not prepare this photo. Try a different browser.')
    // ponytail: a single JPEG output keeps phone photos portable; transparent areas become white.
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.88, 0.74, 0.6, 0.46]) {
      const blob = await encodePhoto(canvas, quality)
      if (blob.size <= MAX_IMAGE_BYTES && ['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) return { blob, image: { mime: blob.type, data: await base64Photo(blob) } }
    }
    throw new Error('This photo could not be prepared. Choose a smaller photo and try again.')
  } finally { source.close?.(); canvas.width = 0; canvas.height = 0 }
}
