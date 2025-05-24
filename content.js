(function() {
	const PROFILE_URL_REGEX = /^\/u\/(?!settings$)([\w-]+)\/?.*$/;
	const STAR_ATTRIBUTE = 'data-friend-star';

	let crawlIntervalId = null;

	// Track what we hide/create so we can undo it
	let TOGGLE_STATE = {
		rankHidden: [],     // original rank cells hidden
		rankAdded: [],      // friend rank cells added
		rowsHidden: [],     // original name rows hidden
		rowsAdded: [],      // friend rows added
		paginationCtrl: null
	};

	// ── SCHEDULE PERIODIC CRAWL ──
	function schedulePeriodicCrawl() {
		const match = location.pathname.match(/^\/contest\/([^/]+)-([^/]+)\/ranking/);
		if (!match) return;
		if (crawlIntervalId) return;
		crawlContestRankings();
		crawlIntervalId = setInterval(crawlContestRankings,  10 * 60 * 1000);
	}

	// ── INIT TABS & HOOK GLOBAL BUTTON ──
	async function initFriendsTab() {
			if (!location.pathname.match(/^\/contest\/[^/]+-[^/]+\/ranking\//)) return;
		
			// find Global
			let globalBtn;
			try {
				globalBtn = await waitForXPath("//button[.//text()='Global']", 5000);
			} catch(e) {
				return;
			}
			if (document.querySelector('#friends-tab-btn')) {
				// still hook Global if not yet done
				if (!globalBtn.hasAttribute('data-friends-global-hooked')) {
					globalBtn.setAttribute('data-friends-global-hooked','1');
					globalBtn.addEventListener('click', showGlobalView);
				}
				return;
			}
		
			// hook Global for toggling back
			globalBtn.setAttribute('data-friends-global-hooked','1');
			globalBtn.addEventListener('click', showGlobalView);
		
			// insert Friends
			const tabs = Array.from(globalBtn.parentElement.querySelectorAll('button'));
			const idx  = tabs.indexOf(globalBtn);
			const llmBtn = idx >= 0 && tabs[idx + 1];
			if (!llmBtn) return;
			llmBtn.addEventListener('click', showLLMView);

		
			const friendsBtn = globalBtn.cloneNode(true);
			friendsBtn.id = 'friends-tab-btn';
			friendsBtn.textContent = 'Friends';
			friendsBtn.setAttribute('data-state', 'inactive');
			friendsBtn.setAttribute('aria-state', 'false');
			friendsBtn.setAttribute('tabindex', 0);
			friendsBtn.addEventListener('click', showFriendsView);
			globalBtn.parentElement.insertBefore(friendsBtn, llmBtn);
		
			// make space
			const tabGroup = globalBtn.parentElement;
			tabGroup.style.display  = 'flex';
			tabGroup.style.flexWrap = 'nowrap';
			tabGroup.style.width    = 'fit-content';
			tabGroup.style.gap      = '0.5rem';
	}
		
		// ── TAB STATE UTIL ──
	function setTabState(activeBtn) {
			const tabGroup = activeBtn.parentElement;
			const buttons = Array.from(tabGroup.querySelectorAll('button'));
			buttons.forEach(btn => {
				if (btn === activeBtn) {
					btn.setAttribute('data-state', 'active');
					btn.setAttribute('aria-state', 'true');
					btn.setAttribute('tabindex', 0);
				} else {
					btn.setAttribute('data-state', 'inactive');
					btn.setAttribute('aria-state', 'false');
					btn.setAttribute('tabindex', -1);
				}
			});
	}
		
		// ── RESTORE GLOBAL VIEW ──
	function showGlobalView() {
			// update button states
			setTabState(this);
			const url = new URL(location.href);
			if (url.searchParams.get('region') === 'friends') {
					url.searchParams.set('region', 'global_v2');
					history.replaceState(null, '', url.toString());
			}
			// undo rank hides
			TOGGLE_STATE.rankHidden.forEach(el => el.style.display = '');
			// remove added friend rank cells
			TOGGLE_STATE.rankAdded.forEach(el => el.remove());
		
			// undo row hides
			TOGGLE_STATE.rowsHidden.forEach(el => el.style.display = '');
			// remove added friend rows
			TOGGLE_STATE.rowsAdded.forEach(el => el.remove());
		
			// show pagination
			if (TOGGLE_STATE.paginationCtrl) {
				TOGGLE_STATE.paginationCtrl.style.display = '';
			}
		
			// reset state
			TOGGLE_STATE = { rankHidden: [], rankAdded: [], rowsHidden: [], rowsAdded: [], paginationCtrl: null };
	}
		
		// ── RENDER FRIENDS VIEW ──
	async function showFriendsView() {
		try{
			// If we’re coming from an LLM view, jump back to the global_v2 URL first
			const url = new URL(location.href);
			const region = url.searchParams.get('region');
			if (region === 'global_v2' || region === 'llm') {
					url.searchParams.set('region', 'friends');
					history.replaceState(null, '', url.toString());
			}
			// additional LLM->Friends UI tweaks
			if (region === 'llm') {
					const showEl = document.querySelector(
					"#__next > div.w-full.bg-\\[\\#ffffff\\].dark\\:bg-\\[\\#1a1a1a\\] > div > div.mx-auto.w-full.grow.p-0.md\\:max-w-none.md\\:p-0.lg\\:max-w-none > div > div.hidden"
					);
					const hideEl = document.querySelector(
					"#__next > div.w-full.bg-\\[\\#ffffff\\].dark\\:bg-\\[\\#1a1a1a\\] > div > div.mx-auto.w-full.grow.p-0.md\\:max-w-none.md\\:p-0.lg\\:max-w-none > div > div:nth-child(4)"
					);
					if (showEl) showEl.classList.remove('hidden');
					if (hideEl) hideEl.classList.add('hidden');
			}
		
			// From here on, we’re on the global_v2 page — proceed with the “hide global + show friends” logic
			// extract contest identifiers from the path
			const m = location.pathname.match(/^\/contest\/([^/]+)-([^/]+)\/ranking\/?/);
			if (!m) return;
			const contestType = m[1];
			const contestKey  = `${m[1]}-${m[2]}`;
		
			// fetch friendsList and contestRankings from storage
			const { friendsList = {} } = await new Promise(r => chrome.storage.local.get('friendsList', r));
			const friendSlugs = Object.keys(friendsList);
			const { contestRankings = {} } = await new Promise(r => chrome.storage.local.get('contestRankings', r));
			const dataObj = (contestRankings[contestKey] || {}).data || {};
		
			// IF no friends’ data yet: show “loading” modal, hook storage listener, then return
      if (!friendSlugs.some(slug => dataObj[slug])) {
        // Only inject our styles once
        if (!document.getElementById('friends-modal-styles')) {
          const style = document.createElement('style');
          style.id = 'friends-modal-styles';
          style.textContent = `
            @keyframes fadeInModal {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
            #friends-loading-modal {
              animation: fadeInModal 0.2s ease-out;
            }
            .friends-modal-spinner {
              border: 4px solid rgba(255,255,255,0.2);
              border-top: 4px solid var(--modal-text, #fff);
              border-radius: 50%;
              width: 32px; height: 32px;
              animation: spin 1s linear infinite;
              margin: 0 auto 16px;
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `;
          document.head.appendChild(style);
        }

        let modal = document.getElementById('friends-loading-modal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'friends-loading-modal';
          modal.setAttribute('role', 'alertdialog');
          modal.setAttribute('aria-modal', 'true');
          Object.assign(modal.style, {
            position:    'fixed',
            inset:       '0',
            background:  'rgba(0,0,0,0.6)',
            display:     'flex',
            alignItems:  'center',
            justifyContent: 'center',
            zIndex:      9999,
            fontFamily:  '"Segoe UI", Tahoma, sans-serif',
          });

          const box = document.createElement('div');
          Object.assign(box.style, {
            backgroundColor: 'var(--lc-bg, #1e1e1e)',
            color:           'var(--modal-text, #fff)',
            padding:         '28px',
            borderRadius:    '10px',
            boxShadow:       '0 6px 20px rgba(0,0,0,0.3)',
            maxWidth:        '280px',
            textAlign:       'center',
            lineHeight:      '1.6',
            position:        'relative',
          });

          // Spinner + Text
          box.innerHTML = `
            <div class="friends-modal-spinner" aria-hidden="true"></div>
            <div style="font-size: 16px; font-weight: 500;">
              Fetching your friends’ contest standings…<br>
              We appreciate your patience—it won’t take long.
            </div>
          `;

          const closeBtn = document.createElement('button');
          closeBtn.setAttribute('aria-label', 'Close loading dialog');
          closeBtn.innerHTML = '✕';
          Object.assign(closeBtn.style, {
            position:    'absolute',
            top:         '8px',
            right:       '8px',
            width:       '28px',
            height:      '28px',
            border:      'none',
            borderRadius:'50%',
            background:  'rgba(255,255,255,0.1)',
            color:       '#fff',
            fontSize:    '16px',
            cursor:      'pointer',
            transition:  'background 0.2s ease',
          });
          closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(255,255,255,0.2)';
          });
          closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(255,255,255,0.1)';
          });
          closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
            chrome.storage.onChanged.removeListener(onChange);
          });

          box.appendChild(closeBtn);
          modal.appendChild(box);
          document.body.appendChild(modal);
        }

        function onChange(changes, area){
          if (area === 'local' && changes.contestRankings) {
            chrome.storage.onChanged.removeListener(onChange);
            const existing = document.getElementById('friends-loading-modal');
            if (existing) document.body.removeChild(existing);
            showFriendsView();
          }
        };
        chrome.storage.onChanged.addListener(onChange);
        return;
      }

      // Update tab‐states for all three buttons
			setTabState(this);
		
			// sort friend entries by rank
			const friends = Object.values(dataObj).sort((a, b) => a.rank - b.rank);
			// Hide global “Rank” header cells, then append friend‐only cells ──
      // No need to call waitForXPath here, since we’re already on the ranking page
			const rankDiv = document.evaluate("//div[text()='Rank']", document, null,
				XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
			if (!rankDiv) return;
			const rankHeaderRow = rankDiv.parentElement.parentElement;
			const allRankCells  = Array.from(rankHeaderRow.children);
		
			allRankCells.slice(1).forEach(el => {
				TOGGLE_STATE.rankHidden.push(el);
				el.style.display = 'none';
			});
		
			const templateCell = allRankCells[0].cloneNode();
			friends.forEach((f, idx) => {
				const cell = templateCell.cloneNode();
				if (idx % 2 === 0) cell.style.backgroundColor = '#ffffff0f';
				cell.textContent = `${f.rank + 1}`;
				rankHeaderRow.appendChild(cell);
				TOGGLE_STATE.rankAdded.push(cell);
			});
		
			// Hide global rows and append each friend row ──
      // No need to call waitForXPath here, since we’re already on the ranking page
			const nameDiv = document.evaluate("//div[text()='Name']", document, null,
				XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
			if (!nameDiv) return;
			let grandpa = nameDiv.parentElement;
			for (let i = 0; i < 2; i++) grandpa = grandpa.parentElement;
		
			Array.from(grandpa.children).forEach(r => {
				TOGGLE_STATE.rowsHidden.push(r);
				r.style.display = 'none';
			});
			
			// --- build and insert header row once ---
			const qHTML = Array.from({ length: 4 }, (_, idx) => {
				return `
						<div class="flex h-full w-full items-center gap-2 rounded-md px-2 text-gray-400">
								<div>Q(${idx + 1})</div>
						</div>`;
			}).join('');

			const newHeaderHTML = `
				<div class="flex h-[50px] min-w-[fit-content] items-start rounded-r-lg overflow-hidden transition-opacity">
						<div class="flex h-[50px] w-full min-w-[fit-content] items-start transition-all duration-500 ease-out">
								<div class="flex h-[50px] flex-[1_0_0] items-center self-stretch relative min-w-[170px] overflow-hidden p-0">
										<div class="absolute flex w-full min-w-[170px] items-center gap-4 overflow-hidden px-4">
												<div class="flex items-center gap-1 overflow-hidden">
														<div class="truncate">Name</div>
												</div>
										</div>
								</div>
								<div class="flex h-[50px] flex-[1_0_0] items-center self-stretch p-4 min-w-[60px] max-w-[100px]">
										Score
								</div>
								<div class="flex h-[50px] flex-[1_0_0] items-center self-stretch p-4 min-w-[130px] max-w-[140px]">
										Finish Time
								</div>
								${qHTML}
						</div>
				</div>`.trim();

			// create and append header
			const headerWrapper = document.createElement('div');
			headerWrapper.innerHTML = newHeaderHTML;
			const headerEl = headerWrapper.firstElementChild;
			grandpa.appendChild(headerEl);
			TOGGLE_STATE.rowsAdded.push(headerEl);

			friends.forEach((f, idx) => {
				const info = f.info;
				const flag = info.country_name && window.countryFlagMap?.[info.country_name]
						? window.countryFlagMap[info.country_name] : '';
				const overall = getElapsedTime(info.finish_time, contestType);

				// only take up to four submissions
				const subs = info.submissions.slice(0, 4); 
				const qHTML = subs.map(s => {
						const { date, lang } = s.data;
						if (date === -1) {
								return `
										<div class="flex h-full w-full items-center gap-2 rounded-md px-2 text-gray-400">
												<span style="display:block; width:14px; height:14px;"></span>
												<div>—</div>
										</div>`;
						}
						const iconUrl = chrome.runtime.getURL(`language-icons/${lang}.svg`);
						return `
								<div class="flex h-full w-full items-center gap-2 rounded-md px-2 cursor-pointer ranking-guide-anchor">
										<span style="display:block;">
												<img src="${iconUrl}" alt="${lang} logo" width="14" height="14"/>
										</span>
										<div>${getElapsedTime(date, contestType)}</div>
								</div>`;
				}).join('');

				const rowHTML = `
						<div class="flex h-[50px] min-w-[fit-content] items-start rounded-r-lg overflow-hidden transition-opacity">
								<div class="flex h-[50px] w-full min-w-[fit-content] items-start transition-all duration-500 ease-out">
										<div class="flex h-[50px] flex-[1_0_0] items-center self-stretch relative min-w-[170px] overflow-hidden p-0">
												<div class="absolute flex w-full min-w-[170px] items-center gap-4 overflow-hidden px-4">
														<a class="no-underline hover:text-blue-s dark:hover:text-dark-blue-s truncate flex items-center gap-4 overflow-hidden" href="/u/${info.user_slug}/">
																<div class="flex items-center gap-1 overflow-hidden">
																		<div class="truncate">${info.username}${flag ? ' ' + flag : ''}</div>
																</div>
														</a>
												</div>
										</div>
										<div class="flex h-[50px] flex-[1_0_0] items-center self-stretch p-4 min-w-[60px] max-w-[100px]">
												${info.score}
										</div>
										<div class="flex h-[50px] flex-[1_0_0] items-center self-stretch p-4 min-w-[130px] max-w-[140px]">
												${overall}
										</div>
										${qHTML}
								</div>
						</div>`.trim();

				const wrapper = document.createElement('div');
				wrapper.innerHTML = rowHTML;
				const rowEl = wrapper.firstElementChild;
				if (idx % 2 === 0) rowEl.style.backgroundColor = '#ffffff0f';
				grandpa.appendChild(rowEl);
				TOGGLE_STATE.rowsAdded.push(rowEl);
			});

		
			// ── 3) Hide the original pagination control ──
			let ctrl = grandpa.parentElement;
			ctrl = ctrl.parentElement && ctrl.parentElement.parentElement;
			if (ctrl && ctrl.children[1]) {
				TOGGLE_STATE.paginationCtrl = ctrl.children[1];
				TOGGLE_STATE.paginationCtrl.style.display = 'none';
			}
		}
		catch(e){

		}
	} 
		
		
	function showLLMView() {
			setTabState(this);
			// …existing LLM logic…
	}

	// ── CONFIG ──
  const MAX_CONCURRENCY = 6;
  const BATCH_SIZE = 250;
  const BATCH_DELAY_MS = 6000;

  // ── HELPERS ──
  // 1) A simple pool to run up to poolLimit promises in parallel
  async function asyncPool(poolLimit, array, iteratorFn) {
    const ret = [];
    const executing = new Set();
    for (const item of array) {
      const p = Promise.resolve().then(() => iteratorFn(item));
      ret.push(p);
      executing.add(p);
      const clean = () => executing.delete(p);
      p.then(clean).catch(clean);
      if (executing.size >= poolLimit) {
        await Promise.race(executing);
      }
    }
    return Promise.all(ret);
  }

  // 2) Fetch one page, retrying once on 429
  async function fetchPage(contestKey, page, friendSlugs, questionIds) {
    try {
      const resp = await fetch(
        `https://leetcode.com/contest/api/ranking/${contestKey}/?pagination=${page}&region=global_v2`
      );
      if (resp.status === 429) {
        // single retry after small delay
        await new Promise(r => setTimeout(r, 1000));
        return fetchPage(contestKey, page, friendSlugs, questionIds);
      }
      if (!resp.ok) return [];
      const json = await resp.json();
      return (json.total_rank || [])
        .filter(e => friendSlugs.has(e.user_slug))
        .map(entry => {
          // rebuild ordered submissions array
          const subs = entry.submissions || {};
          entry.submissions = questionIds.map(qid => ({
            question_id: qid,
            data: subs[qid] || { date: -1, lang: null },
          }));
          return entry;
        });
    } catch {
      return [];
    }
  }

  // 3) Split pages into batches and throttle between them
  async function crawlInBatches(allPages, contestKey, friendSlugs, questionIds) {
    const batches = [];
    for (let i = 0; i < allPages.length; i += BATCH_SIZE) {
      batches.push(allPages.slice(i, i + BATCH_SIZE));
    }

    let results = [];
    for (const batch of batches) {
      const batchResults = await asyncPool(
        MAX_CONCURRENCY,
        batch,
        page => fetchPage(contestKey, page, friendSlugs, questionIds)
      );
      results = results.concat(...batchResults);
      // throttle before next batch
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
    return results;
  }

  // ── MAIN FUNCTION ──
  async function crawlContestRankings() {
    try{
      const m = location.pathname.match(/^\/contest\/([^/]+)-([^/]+)\/ranking\/?/);
      if (!m) return;
      const contestKey = `${m[1]}-${m[2]}`;

      // load friends
      const { friendsList = {} } = await new Promise(r =>
        chrome.storage.local.get("friendsList", r)
      );
      const friendSlugs = new Set(Object.keys(friendsList));
      if (!friendSlugs.size) return;

      // load existing data
      const { contestRankings = {} } = await new Promise(r =>
        chrome.storage.local.get("contestRankings", r)
      );
      const thisContest = contestRankings[contestKey] || { timestamp: 0, data: {} };

      // fetch question order
      const infoResp = await fetch(
        `https://leetcode.com/contest/api/info/${contestKey}/`
      );
      let questionIds = [];
      if (infoResp.ok) {
        try {
          const infoJson = await infoResp.json();
          questionIds = (infoJson.questions || []).map(q => String(q.question_id));
        } catch {}
      }

      // get total pages from page 1
      const firstResp = await fetch(
        `https://leetcode.com/contest/api/ranking/${contestKey}/?pagination=1&region=global_v2`
      );
      if (!firstResp.ok) return;
      const firstJson = await firstResp.json();
      const totalNum = firstJson.user_num || 0;
      const pageSize = 25;
      const totalPages = 500;
      const allPages = Array.from({ length: totalPages }, (_, i) => i + 1);

      // crawl in throttled batches
      const friendEntries = await crawlInBatches(
        allPages, contestKey, friendSlugs, questionIds
      );

      // merge results
      friendEntries.forEach(entry => {
        const slug = entry.user_slug;
        const rank = entry.rank;
        const prev = thisContest.data[slug];
        if (!prev || rank <= prev.rank) {
          thisContest.data[slug] = { rank, info: entry };
        }
      });

      // save back
      thisContest.timestamp = Date.now();
      contestRankings[contestKey] = thisContest;
      await new Promise(r => chrome.storage.local.set({ contestRankings }, r));
    } catch{

    }
  }


		
	// ── TIME FORMAT HELPER ──
	function getElapsedTime(submissionUnix, contestType) {
		const submissionDate = new Date(submissionUnix * 1000);
		const startHourIST = contestType.startsWith('weekly') ? 8 : 20;
		const istOffsetMin = 5 * 60 + 30;
		const y = submissionDate.getUTCFullYear(),
					mo = submissionDate.getUTCMonth(),
					d = submissionDate.getUTCDate();
		const startUTC = new Date(Date.UTC(y,mo,d,startHourIST,0,0));
		startUTC.setUTCMinutes(startUTC.getUTCMinutes() - istOffsetMin);
		const diff = submissionDate - startUTC;
		if (diff < 0) return '00:00:00';
		let sec = Math.floor(diff/1000),
				h = Math.floor(sec/3600); sec %= 3600;
		let m = Math.floor(sec/60); sec %= 60;
		const p = n => String(n).padStart(2,'0');
		return `${p(h)}:${p(m)}:${p(sec)}`;
	}

	// ── XPATH UTILITY ──
  // This function waits for an XPath to resolve, returning the first matching element or rejecting after a timeout
	function waitForXPath(xpath, timeout = 5000) {
		return new Promise((resolve,reject) => {
			const start = Date.now();
			(function check() {
				const r = document.evaluate(xpath, document, null,
					XPathResult.FIRST_ORDERED_NODE_TYPE, null);
				if (r.singleNodeValue) return resolve(r.singleNodeValue);
				if (Date.now() - start > timeout) return reject();
				requestAnimationFrame(check); // we could use setTimeout, but requestAnimationFrame is more efficient
			})();
		});
	}

	// ── FRIEND STAR INJECTION ──
	async function injectStar() {
		try{
      const match = window.location.pathname.match(PROFILE_URL_REGEX);
      if (!match) return;
      const userSlug = match[1];
      try {
        const rankDiv = await waitForXPath("//span[text()='Rank']");
        const rankContainer = rankDiv.parentElement;
        if (rankContainer.querySelector(`[${STAR_ATTRIBUTE}]`)) return;

        const header = rankContainer.closest('div.flex.flex-col');
        const nameDiv = header.querySelector('div.text-base.font-semibold');
        const username = nameDiv ? nameDiv.textContent.trim() : userSlug;
        const slugDiv = header.querySelector('div.text-xs');
        const slug = slugDiv ? slugDiv.textContent.trim() : userSlug;

        const star = document.createElement('span');
        star.setAttribute(STAR_ATTRIBUTE, slug);
        star.style.cursor = 'pointer';
        star.style.marginLeft = '8px';

        chrome.storage.local.get('friendsList', data => {
          star.textContent = data.friendsList?.[slug] ? '⭐' : '☆';
        });

        star.addEventListener('click', () => {
          chrome.storage.local.get('friendsList', data => {
            const friends = data.friendsList || {};
            if (friends[slug]) {
              if (!confirm(`Remove friend ${username}?`)) return;
              delete friends[slug];
              star.textContent = '☆';
            } else {
              if (!confirm(`Do you want friend ${username}?`)) return;
              friends[slug] = { username, userSlug: slug};
              star.textContent = '⭐';
            }
            chrome.storage.local.set({ friendsList: friends });
          });
        });

        rankContainer.appendChild(star);
      } catch {

      }
    } catch{
      
    }
	}

	// ── SPA NAV OBSERVER ──
	let lastPath = location.pathname;
	new MutationObserver(() => {
		if (location.pathname !== lastPath) {
			lastPath = location.pathname;
			injectStar();
			initFriendsTab();
			schedulePeriodicCrawl();
		}
	}).observe(document, { subtree: true, childList: true });

	// ── INITIAL RUN ──
	injectStar();
	initFriendsTab();
	schedulePeriodicCrawl();

})();
