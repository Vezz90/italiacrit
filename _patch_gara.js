const fs = require('fs');
let src = fs.readFileSync('C:/Users/vezza/.gemini/antigravity/scratch/italiacrit/app.js', 'utf8');

// ── SECTION BOUNDARIES ──────────────────────────────────────────────────────
const START_MARKER = '  // Carica foto approvate in parallelo con il render\r\n  let racePhotosHtml = \'\';';
const END_MARKER   = 'window._shareGaraData';

const sectionStart = src.indexOf(START_MARKER);
const sectionEnd   = src.indexOf(END_MARKER);

if (sectionStart === -1 || sectionEnd === -1) {
  console.error('Markers not found!', sectionStart, sectionEnd);
  process.exit(1);
}

const NEW_SECTION = `  // Video YouTube associati alla gara\r
  const _calId = (globalData.garaToCalId || {})[gara_id] || gara_id;\r
  const garaVideos = (globalData.videos || {})[_calId] || (globalData.videos || {})[gara_id] || [];\r
  const featuredVideo = garaVideos[0] || null;\r
  const featuredVideoId = featuredVideo ? (featuredVideo.url.match(/[?&]v=([^&]+)/) || [])[1] || null : null;\r
  const extraVideos = garaVideos.slice(1);\r
\r
  // Carica foto approvate in parallelo con il render\r
  let racePhotosHtml = '';\r
  let extraVideosHtml = '';\r
  try {\r
    const photosData = await fetch(\`\${API_BASE}/race-photos/\${encodeURIComponent(gara_id)}\`).then(r=>r.json()).catch(()=>({photos:[]}));\r
    const photos = photosData.photos || [];\r
    const user = authUser();\r
    const uploadBtn = user\r
      ? \`<button class="race-photo-upload-btn" onclick="window.openRacePhotoUpload('\${esc(gara_id)}')">\r
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>\r
           Carica foto\r
         </button>\`\r
      : \`<span style="font-size:0.8rem;color:var(--text-muted)">Accedi per caricare una foto</span>\`;\r
    const isAdmin = user?.role === 'admin';\r
\r
    // Hero: first photo + first video side by side (or full-width if only one)\r
    const featuredPhoto = photos[0] || null;\r
    const heroPhotoEl = featuredPhoto\r
      ? \`<div class="gara-media-half gara-media-photo" onclick="window.openPhotoLightbox('\${PHOTOS_BASE}/photos/\${esc(featuredPhoto.filename)}')" style="cursor:zoom-in">\r
           <img src="\${PHOTOS_BASE}/photos/\${esc(featuredPhoto.filename)}" alt="\${esc(featuredPhoto.caption||'Foto gara')}" loading="lazy"/>\r
         </div>\`\r
      : '';\r
    const heroVideoEl = featuredVideoId\r
      ? \`<div class="gara-media-half gara-media-video" onclick="window.openVideoModal('\${featuredVideoId}','\${esc((featuredVideo.title||'').replace(/'/g, "\\\\'"))}')"> \r
           <img src="https://img.youtube.com/vi/\${featuredVideoId}/hqdefault.jpg" alt="\${esc(featuredVideo.title||'Video')}" loading="lazy"/>\r
           <div class="gara-media-play"><span>&#9658;</span></div>\r
           <div class="gara-media-channel">\${esc(featuredVideo.channel||'')}</div>\r
         </div>\`\r
      : '';\r
    const heroMedia = (heroPhotoEl || heroVideoEl)\r
      ? \`<div class="gara-hero-media\${featuredPhoto && featuredVideoId ? ' gara-hero-split' : ''}">\${heroPhotoEl}\${heroVideoEl}</div>\`\r
      : '';\r
\r
    const extraPhotos = photos.slice(1);\r
    const gallery = extraPhotos.length\r
      ? \`<div class="race-gallery">\${extraPhotos.map(p=>\`\r
          <div class="race-gallery-item" id="gal-photo-\${p.id}"\r
            data-caption="\${esc(p.caption||'')}"\r
            data-photographer="\${esc(p.photographer||'')}">\r
            <img src="\${PHOTOS_BASE}/photos/\${esc(p.filename)}" alt="\${esc(p.caption||'Foto gara')}" loading="lazy" onclick="window.openPhotoLightbox('\${PHOTOS_BASE}/photos/\${esc(p.filename)}')" style="cursor:zoom-in"/>\r
            <div class="race-gallery-caption">\${[p.caption, p.photographer ? '📷 '+p.photographer : '', p.display_name].filter(Boolean).join(' — ')}</div>\r
            \${isAdmin ? \`<div style="position:absolute;top:4px;right:4px;display:flex;flex-direction:column;gap:3px;z-index:10">\r
              <button onclick="event.stopPropagation();window.adminEditPhoto(\${p.id})" style="padding:3px 7px;font-size:0.68rem;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)">&#9999;&#65039; Modifica</button>\r
              <button onclick="event.stopPropagation();window.adminDeletePhoto(\${p.id})" style="padding:3px 7px;font-size:0.68rem;background:#dc2626;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)">&#128465; Elimina</button>\r
            </div>\` : ''}\r
          </div>\`).join('')}\r
        </div>\`\r
      : (!featuredPhoto ? \`<p style="color:var(--text-muted);font-size:0.875rem;margin:8px 0 0">Nessuna foto ancora. Sii il primo a condividerne una!</p>\` : '');\r
\r
    racePhotosHtml = \`\r
      <div class="comp-section" style="margin-top:16px">\r
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:\${heroMedia ? '12px' : '0'}">\r
          <div class="comp-section-title" style="margin-bottom:0;border:none;padding:0">Foto & Video</div>\r
          \${uploadBtn}\r
        </div>\r
        \${heroMedia}\r
        \${gallery}\r
      </div>\`;\r
\r
    if (extraVideos.length) {\r
      extraVideosHtml = \`\r
        <div class="comp-section" style="margin-top:12px">\r
          <div class="comp-section-title">Altri Video</div>\r
          <div class="gara-videos-grid">\r
            \${extraVideos.map(v => {\r
              const vidId = (v.url.match(/[?&]v=([^&]+)/) || [])[1] || '';\r
              const thumb = vidId ? \`https://img.youtube.com/vi/\${vidId}/mqdefault.jpg\` : '';\r
              return \`\r
                <div class="gara-video-card" style="cursor:pointer" onclick="window.openVideoModal('\${vidId}','\${esc((v.title||'').replace(/'/g, "\\\\'"))}')">\r
                  \${thumb ? \`<div class="gara-video-thumb">\r
                    <img src="\${thumb}" alt="\${esc(v.title)}" loading="lazy"/>\r
                    <div class="gara-video-play">&#9658;</div>\r
                  </div>\` : ''}\r
                  <div class="gara-video-info">\r
                    <div class="gara-video-title">\${esc(v.title)}</div>\r
                    <div class="gara-video-meta">\${esc(v.channel)}</div>\r
                  </div>\r
                </div>\`;\r
            }).join('')}\r
          </div>\r
        </div>\`;\r
    }\r
  } catch(e) { /* silent */ }\r
\r
  `;

src = src.slice(0, sectionStart) + NEW_SECTION + src.slice(sectionEnd);

// ── SETPAGE: swap ${videosHtml} + ${racePhotosHtml} ─────────────────────────
src = src.replace(
  '    ${videosHtml}\r\n    ${racePhotosHtml}',
  '    ${racePhotosHtml}\r\n    ${extraVideosHtml}'
);

fs.writeFileSync('C:/Users/vezza/.gemini/antigravity/scratch/italiacrit/app.js', src);
console.log('Done. File size:', src.length);
