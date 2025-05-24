document.addEventListener('DOMContentLoaded', () => {
    const contentDiv = document.getElementById('content');

    const gqlFetch = (query, variables) => {
        return fetch('https://leetcode.com/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables }),
        })
        .then(res => res.json())
        .then(json => json.data);
    };

    function renderFriends(friends) {
        contentDiv.innerHTML = '';
        if (!friends || Object.keys(friends).length === 0) {
            const msg = document.createElement('p');
            msg.textContent = 'There is no current friend.';
            msg.style.padding = '16px';
            msg.style.textAlign = 'center';
            contentDiv.appendChild(msg);
            return;
        }

        Object.entries(friends).forEach(([slug, info]) => {
            const item = document.createElement('div');
            item.className = 'friend-item';

            // Info column
            const infoCol = document.createElement('div');
            infoCol.className = 'friend-info';
            const name = document.createElement('p');
            name.className = 'friend-name';
            name.textContent = info.username;
            const slugDiv = document.createElement('p');
            slugDiv.className = 'friend-slug';
            slugDiv.textContent = slug;
            // Rating placeholder
            const rating = document.createElement('p');
            rating.className = 'friend-rating';
            rating.textContent = 'Rating: Loading...';
            // Submission date placeholder
            const lastSub = document.createElement('p');
            lastSub.className = 'friend-last-submission';
            lastSub.textContent = 'Last Submission: Loading...';

            infoCol.append(name, slugDiv, rating, lastSub);

            // Fetch contest rating
            const ratingQuery = `
                query userContestRankingInfo($username: String!) {
                    userContestRanking(username: $username) {
                        rating
                    }
                }
            `;
            gqlFetch(ratingQuery, { username: slug })
                .then(data => {
                    const r = data.userContestRanking?.rating;
                    const rounded = (r != null) ? Math.round(r) : null;
                    rating.textContent = `Rating: ${rounded != null ? rounded : 'N/A'}`;
                })
                .catch(() => {
                    rating.textContent = 'Rating: N/A';
                });

            // Fetch last submission date
            const calQuery = `
                query userProfileCalendar($username: String!, $year: Int) {
                    matchedUser(username: $username) {
                        userCalendar(year: $year) {
                            submissionCalendar
                        }
                    }
                }
            `;
            const currentYear = new Date().getFullYear();
            gqlFetch(calQuery, { username: slug, year: currentYear })
                .then(data => {
                    const calendar = JSON.parse(data.matchedUser?.userCalendar?.submissionCalendar || '{}');
                    const timestamps = Object.keys(calendar).map(ts => parseInt(ts, 10));
                    if (timestamps.length) {
                        const lastTs = Math.max(...timestamps);
                        const dateObj = new Date(lastTs * 1000);
                        if (isNaN(dateObj)) {
                            lastSub.textContent = 'Last Submission: N/A';
                        } else {
                            const dateStr = dateObj.toLocaleDateString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                day: 'numeric', month: 'short', year: 'numeric'
                            });
                            lastSub.textContent = `Last Submission:\n ${dateStr}`;
                        }
                    } else {
                        lastSub.textContent = 'Last Submission: N/A';
                    }
                })
                .catch(() => {
                    lastSub.textContent = 'Last Submission: N/A';
                });

            // Actions column
            const actions = document.createElement('div');
            actions.className = 'friend-actions';

            // LeetCode icon
            const icon = document.createElement('img');
            icon.className = 'icon';
            icon.src = 'leetcode-logo.png';
            icon.title = 'View Profile';
            icon.addEventListener('click', e => {
                e.stopPropagation();
                chrome.tabs.create({ url: `https://leetcode.com/u/${slug}/` });
            });

            // Unfriend button
            const btn = document.createElement('button');
            btn.textContent = 'Unfriend';
            btn.addEventListener('click', e => {
                e.stopPropagation();
                if (!confirm(`Remove friend ${info.username}?`)) return;
                chrome.storage.local.get('friendsList', data => {
                    const friends = data.friendsList || {};
                    delete friends[slug];
                    chrome.storage.local.set({ friendsList: friends }, () => {
                        renderFriends(friends);
                    });
                });
            });

            actions.append(icon, btn);
            item.append(infoCol, actions);

            // Clicking the row opens profile
            item.addEventListener('click', () => {
                chrome.tabs.create({ url: `https://leetcode.com/u/${slug}/` });
            });

            contentDiv.appendChild(item);
        });
    }

    function loadAndRender() {
        chrome.storage.local.get('friendsList', data => {
            renderFriends(data.friendsList);
        });
    }

    // Initial render
    loadAndRender();
});