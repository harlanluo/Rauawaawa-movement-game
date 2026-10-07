        /* ---------------------------------------------------- */
        /* APPLICATION STATE & LOGIC                            */
        /* ---------------------------------------------------- */
        const browserOnly = new URLSearchParams(location.search).get('libraryBackend') !== 'local';
        const browserLibraryModule = browserOnly ? import('./browser-library.js') : null;
        let isVoiceMode = false;
        let voiceLanguage = 'en';
        let voiceReturnFocus = null;
        let speechGeneration = 0;
        let currentFocusedButton = null;
        let currentMode = 'Seated'; // 'Seated' or 'Standing'
        let currentGameNumber = 1;
        let isGameRunning = false;
        let isGamePaused = false;
        let isGameReady = false;
        let isFullscreenActive = false;
        let currentScore = 0;
        let nextGameId = 7;
        let selectedVideoFileName = '';
        let selectedVideoFile = null;
        let processedVideoSrc = null;
        let processedReferenceSrc = null;
        let extractionMode = 'Standing';
        let extractionController = null;
        let extractionJobId = null;
        let processingFailed = false;

        function updateProcessingReady() {
            document.getElementById('processingContinueBtn').disabled =
                processingFailed || !processedVideoSrc || !processedReferenceSrc;
        }

        function stopExtraction() {
            extractionController?.abort();
            extractionController = null;
            if (extractionJobId) {
                fetch(`/api/reference-pose/${extractionJobId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
                extractionJobId = null;
            }
        }

        async function extractUploadedMovement(file) {
            stopExtraction();
            const controller = new AbortController();
            extractionController = controller;
            const status = document.getElementById('extractionStatus');
            status.textContent = 'Extracting movement from the original video…';
            let jobId = null;
            try {
                if (browserOnly) {
                    const { extractBrowserReference } = await import('./browser-reference.js');
                    const reference = await extractBrowserReference(file, { mode: extractionMode.toLowerCase(), signal: controller.signal,
                        onProgress: message => { if (!controller.signal.aborted) status.textContent = message; } });
                    if (controller.signal.aborted) return;
                    processedReferenceSrc = URL.createObjectURL(new Blob([JSON.stringify(reference)], { type: 'application/json' }));
                    status.textContent = 'Movement guide ready — scoring enabled for this video.';
                    updateProcessingReady();
                    return;
                }
                const response = await fetch('/api/reference-pose', {
                    method: 'POST', body: file, signal: controller.signal,
                    headers: { 'X-Body-Mode': extractionMode.toLowerCase() }
                });
                if (!response.ok) {
                    let detail = 'Open the local game on port 8001 to enable movement extraction.';
                    try { detail = (await response.json()).error || detail; } catch {}
                    throw new Error(detail);
                }
                jobId = (await response.json()).id;
                if (controller.signal.aborted) return;
                extractionJobId = jobId;
                while (!controller.signal.aborted) {
                    const poll = await fetch(`/api/reference-pose/${jobId}`, { signal: controller.signal });
                    const job = await poll.json();
                    if (!poll.ok || job.state === 'failed' || job.state === 'cancelled') {
                        throw new Error(job.error || 'Movement extraction stopped.');
                    }
                    if (job.state === 'complete') {
                        processedReferenceSrc = URL.createObjectURL(new Blob([JSON.stringify(job.reference)], { type: 'application/json' }));
                        status.textContent = 'Movement guide ready — scoring enabled for this video.';
                        extractionJobId = null;
                        updateProcessingReady();
                        return;
                    }
                    await new Promise(resolve => {
                        const onAbort = () => { clearTimeout(timer); resolve(); };
                        const timer = setTimeout(() => {
                            controller.signal.removeEventListener('abort', onAbort);
                            resolve();
                        }, 1000);
                        controller.signal.addEventListener('abort', onAbort, { once: true });
                    });
                }
            } catch (error) {
                if (controller.signal.aborted) return;
                processingFailed = true;
                status.textContent = `Movement extraction failed: ${error.message}. Cancel and try again.`;
                updateProcessingReady();
            } finally {
                if (controller.signal.aborted && jobId) {
                    fetch(`/api/reference-pose/${jobId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
                }
            }
        }
        let recordingInterval = null;
        let recordingSeconds = 0;
        let processingInterval = null;

        const DEFAULT_VIDEO_SRC = 'assets/videos/e9d87196a2d98e530ab1ddebd7c56c5e.mp4';
        const DEFAULT_REFERENCE_POSE_SRC = 'assets/games/demo-standing/reference-pose.json';

        // In-memory prototype library. Changes intentionally disappear on refresh.
        const gameLibrary = [
            { id: 1, name: 'Game 1', mode: 'Both', description: 'Gentle Upper Body', videoSrc: DEFAULT_VIDEO_SRC, referencePoseSrc: DEFAULT_REFERENCE_POSE_SRC },
            { id: 2, name: 'Game 2', mode: 'Both', description: 'Arm Reach and Stretch', videoSrc: DEFAULT_VIDEO_SRC, referencePoseSrc: DEFAULT_REFERENCE_POSE_SRC },
            { id: 3, name: 'Game 3', mode: 'Both', description: 'Shoulder Twist and Wave', videoSrc: DEFAULT_VIDEO_SRC, referencePoseSrc: DEFAULT_REFERENCE_POSE_SRC },
            { id: 4, name: 'Game 4', mode: 'Both', description: 'Core Stability', videoSrc: DEFAULT_VIDEO_SRC, referencePoseSrc: DEFAULT_REFERENCE_POSE_SRC },
            { id: 5, name: 'Game 5', mode: 'Both', description: 'Side Tap Rhythm', videoSrc: DEFAULT_VIDEO_SRC, referencePoseSrc: DEFAULT_REFERENCE_POSE_SRC },
            { id: 6, name: 'Game 6', mode: 'Both', description: 'Gentle Cool Down', videoSrc: DEFAULT_VIDEO_SRC, referencePoseSrc: DEFAULT_REFERENCE_POSE_SRC }
        ];

        const videoEl = document.getElementById('gameVideo');
        const videoSourceEl = document.getElementById('videoSourceEl');
        const btnPauseGame = document.getElementById('btnPauseGame');
        const btnFullscreenToggle = document.getElementById('btnFullscreenToggle');
        const pauseOverlay = document.getElementById('pauseOverlay');
        const avatarSvg = document.getElementById('avatarSvg');
        const videoProgress = document.getElementById('videoProgress');
        const videoCurrentTime = document.getElementById('videoCurrentTime');
        const videoDuration = document.getElementById('videoDuration');
        const playbackSpeed = document.getElementById('playbackSpeed');
        const gameScoreDisplay = document.getElementById('gameScoreDisplay');
        const finalScoreVal = document.getElementById('finalScoreVal');
        const movementFeedback = document.getElementById('movementFeedback');

        let poseTracker = null;
        let poseModule = null;
        let poseSession = 0;
        let poseDebugTimer = null;
        let cameraEnabled = false;
        let cameraStarting = false;
        let scoringSession = null;
        let scoringLoadToken = 0;
        let scoringModule = null;
        let seekGeneration = 0;
        let timelineDragging = false;
        let seekPending = false;
        let playbackGeneration = 0;
        const referencePoseCache = new Map();
        const cameraToggle = document.getElementById('cameraToggle');
        const avatarPanel = document.getElementById('avatarPanel');
        const avatarPose = createAvatarPoseController(avatarSvg);
        const trackingStatus = document.getElementById('trackingStatus');
        const poseDebug = new URLSearchParams(location.search).get('poseDebug') === '1';
        const poseDebugPanel = document.getElementById('poseDebugPanel');
        const posePreviewCanvas = document.getElementById('posePreviewCanvas');
        const posePreviewToggle = document.getElementById('posePreviewToggle');
        let posePreviewEnabled = false;

        function setPosePreview(enabled) {
            posePreviewEnabled = poseDebug && enabled;
            posePreviewCanvas.hidden = !posePreviewEnabled;
            posePreviewToggle.setAttribute('aria-pressed', String(posePreviewEnabled));
            posePreviewToggle.textContent = posePreviewEnabled
                ? 'Hide camera + skeleton' : 'Show camera + skeleton';
            poseDebugPanel.hidden = !poseDebug || posePreviewEnabled;
            if (!posePreviewEnabled) {
                const context = posePreviewCanvas.getContext?.('2d');
                context?.clearRect(0, 0, posePreviewCanvas.width, posePreviewCanvas.height);
            }
        }

        posePreviewToggle.hidden = !poseDebug;
        posePreviewToggle.addEventListener('click', () => setPosePreview(!posePreviewEnabled));

        function renderPoseDiagnostics() {
            if (!poseDebug) return;
            poseDebugPanel.hidden = posePreviewEnabled;
            poseDebugPanel.textContent = JSON.stringify(window.playerPoseTracking.getDiagnostics(), null, 2);
        }

        function updateMovementFeedback(message, rating = 'idle', values) {
            if (movementFeedback.dataset.languageKey !== message || movementFeedback._languageValues?.focus !== values?.focus) {
                PlayerLanguage.render(movementFeedback, message, values);
            }
            movementFeedback.dataset.rating = rating;
        }

        function resetMovementScore(message = 'Turn camera on to score') {
            currentScore = 0;
            gameScoreDisplay.textContent = currentScore;
            scoringSession = null;
            updateMovementFeedback(message);
        }

        async function loadReferencePose(url) {
            if (!referencePoseCache.has(url)) {
                referencePoseCache.set(url, fetch(url).then(response => {
                    if (!response.ok) throw new Error(`Reference pose request failed (${response.status})`);
                    return response.json();
                }).catch(error => {
                    referencePoseCache.delete(url);
                    throw error;
                }));
            }
            return referencePoseCache.get(url);
        }

        async function preparePoseScoring(game) {
            const token = ++scoringLoadToken;
            scoringSession = null;
            if (!game?.referencePoseSrc) {
                updateMovementFeedback('Scoring is not available for this game', 'insufficient');
                return;
            }
            updateMovementFeedback('Loading movement guide…');
            try {
                if (!scoringModule) scoringModule = import('./pose-scoring.js');
                const [module, referenceData] = await Promise.all([
                    scoringModule,
                    loadReferencePose(game.referencePoseSrc)
                ]);
                if (token !== scoringLoadToken || !isGameRunning) return;
                scoringSession = module.createPoseScoringSession(referenceData, {
                    comparisonOptions: { bodyMode: currentMode.toLowerCase() }
                });
                updateMovementFeedback(cameraEnabled ? 'Follow the movement' : 'Turn camera on to score');
            } catch (error) {
                console.warn('Pose scoring could not start', error);
                if (token === scoringLoadToken && isGameRunning) {
                    updateMovementFeedback('Movement scoring unavailable', 'insufficient');
                }
            }
        }

        function renderPoseScore(update) {
            if (!update?.result) return;
            currentScore = update.score;
            gameScoreDisplay.textContent = currentScore;
            const { result } = update;
            if (result.rating === 'good') {
                updateMovementFeedback('Good - keep moving!', 'good');
            } else if (result.rating === 'almost') {
                const focus = result.feedback[0]?.label;
                updateMovementFeedback(focus ? 'Almost - adjust your {focus}' : 'Almost - keep going!', 'almost',
                    focus ? { focus, focusMi: PlayerLanguage.entry(focus).mi || focus } : undefined);
            } else if (result.rating === 'miss') {
                const focus = result.feedback[0]?.label;
                updateMovementFeedback(focus ? 'Keep moving - follow the {focus}' : 'Keep moving - follow along', 'miss',
                    focus ? { focus, focusMi: PlayerLanguage.entry(focus).mi || focus } : undefined);
            } else if (result.rating === 'insufficient') {
                updateMovementFeedback(currentMode === 'Seated'
                    ? 'Make sure your shoulders and arms are visible'
                    : 'Step back so your full body is visible', 'insufficient');
            } else if (result.rating === 'skipped') {
                updateMovementFeedback('Keep moving - scoring will resume shortly');
            }
        }

        function updatePoseScoring(playerLandmarks, capture) {
            if (!isGameRunning || isGameReady || isGamePaused || !cameraEnabled ||
                !scoringSession || videoEl.paused || videoEl.ended || videoEl.seeking ||
                timelineDragging || seekPending || !playerLandmarks ||
                capture?.session !== poseSession || capture?.seek !== seekGeneration) return;
            renderPoseScore(scoringSession.update(videoEl.currentTime * 1000, playerLandmarks));
        }

        function updateTrackingStatus({ state, message }) {
            if (state === 'paused' && cameraStarting) message = 'Starting camera…';
            if (trackingStatus.dataset.languageKey !== message) PlayerLanguage.render(trackingStatus, message);
            trackingStatus.dataset.state = state;
            avatarPanel.dataset.tracking = state;
            if (state !== 'detected') avatarPose.reset();
            if (state === 'unavailable') {
                cameraStarting = false;
                cameraEnabled = false;
                clearInterval(poseDebugTimer);
                poseDebugTimer = null;
            }
            const active = cameraEnabled && ['loading', 'looking', 'detected', 'paused'].includes(state);
            const previewAvailable = cameraEnabled && ['looking', 'detected', 'paused'].includes(state);
            posePreviewToggle.disabled = !previewAvailable;
            if (!previewAvailable && posePreviewEnabled) setPosePreview(false);
            PlayerLanguage.render(cameraToggle, cameraEnabled && cameraStarting
                ? 'Cancel Camera Start' : active ? 'Turn Camera Off' : 'Turn Camera On');
            cameraToggle.setAttribute('aria-pressed', String(cameraEnabled));
            cameraToggle.setAttribute('data-speech', PlayerLanguage.entry(cameraToggle.dataset.languageKey).speechEn);
            const cameraError = document.getElementById('cameraError');
            cameraError.hidden = state !== 'unavailable';
            if (!cameraError.hidden) PlayerLanguage.render(cameraError, message);
            cameraToggle.setAttribute('aria-describedby', cameraError.hidden ? '' : 'cameraError');
        }

        function stopPlayerTracking() {
            cameraStarting = false;
            cameraEnabled = false;
            poseSession++;
            poseTracker?.stop();
            setPosePreview(false);
            clearInterval(poseDebugTimer);
            poseDebugTimer = null;
            updateTrackingStatus({ state: 'stopped', message: 'Camera off' });
            if (isGameRunning) updateMovementFeedback('Turn camera on to score');
            renderPoseDiagnostics();
        }

        function togglePlayerCamera() {
            if (!isGameRunning) return;
            if (cameraEnabled) stopPlayerTracking();
            else {
                cameraEnabled = true;
                cameraStarting = true;
                void startPlayerTracking();
            }
        }

        async function startPlayerTracking() {
            const session = ++poseSession;
            updateTrackingStatus({ state: 'starting', message: 'Starting camera…' });
            try {
                if (!poseModule) {
                    poseModule = import('./pose-tracker.js').catch(error => {
                        poseModule = null;
                        throw error;
                    });
                }
                const { createPoseTracker } = await poseModule;
                if (session !== poseSession || !isGameRunning || !cameraEnabled) return;
                if (!poseTracker) {
                    poseTracker = createPoseTracker({
                        forceCPU: new URLSearchParams(location.search).get('poseDelegate') === 'cpu',
                        onStatus: updateTrackingStatus,
                        getCaptureContext: () => ({ session: poseSession, seek: seekGeneration }),
                        onPose: (timestamp, capture) => {
                            if (cameraEnabled && isGameRunning && !isGamePaused && capture?.session === poseSession && capture?.seek === seekGeneration) {
                                const landmarks = poseTracker.getLatestLandmarks();
                                avatarPose.update(landmarks, timestamp);
                                updatePoseScoring(landmarks, capture);
                                if (posePreviewEnabled) poseTracker.drawDebugFrame(posePreviewCanvas);
                            }
                        }
                    });
                }
                const started = poseTracker.start();
                if (poseDebug) poseDebugTimer = setInterval(renderPoseDiagnostics, 1000);
                if (isGamePaused) poseTracker.pauseProcessing();
                await started;
                if (session === poseSession && cameraEnabled) {
                    cameraStarting = false;
                    const state = poseTracker.getDiagnostics().state;
                    updateTrackingStatus({ state, message: state === 'paused' ? 'Tracking paused' : 'Looking for you…' });
                }
                renderPoseDiagnostics();
            } catch (error) {
                console.warn('Player tracker could not start', error);
                if (session === poseSession && isGameRunning) {
                    updateTrackingStatus({ state: 'unavailable', message: 'Movement tracking unavailable' });
                }
            }
        }

        // Read-only access for future pose consumers and device testing; no session recording.
        window.playerPoseTracking = Object.freeze({
            getLatestLandmarks: () => poseTracker?.getLatestLandmarks() || null,
            getDiagnostics: () => poseTracker?.getDiagnostics() || { state: 'not-loaded' }
        });
        window.addEventListener('pagehide', () => { stopGameSession(); stopExtraction(); ++recorderLoadToken; staffRecorder?.reset(); });

        // Screen Navigation
        function goToScreen(screenId) {
            if (screenId !== 'screen-record-video') {
                ++recorderLoadToken;
                staffRecorder?.reset();
            }
            if (screenId !== 'screen-processing') {
                stopExtraction();
                clearInterval(processingInterval);
                const processingFrame = document.getElementById('stylizerFrame');
                if (processingFrame.getAttribute('src') && processingFrame.getAttribute('src') !== 'about:blank') {
                    processingFrame.src = 'about:blank';
                }
            }
            closeVoicePanel(false);
            clearVoiceFocus();
            stopGameSession();

            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            const targetScreen = document.getElementById(screenId);
            if (targetScreen) {
                targetScreen.classList.add('active');
            }

            if (screenId === 'screen-win') {
                triggerConfetti();
                if (isVoiceMode) {
                    speak('Congratulations! Your score is {score} points. Ka Pai!', true, { score: currentScore });
                }
            }
        }

        // Open Playlist for Seated or Standing
        function openPlaylist(mode) {
            currentMode = mode;
            PlayerLanguage.render(document.getElementById('playlistHeaderTitle'), `${mode} Playlist`);
            renderKaumatuaGameLibrary();
            goToScreen('screen-playlist');
        }

        function getGamesForCurrentMode() {
            return gameLibrary.filter(game => game.mode === currentMode || game.mode === 'Both');
        }

        function renderKaumatuaGameLibrary() {
            const grid = document.getElementById('kaumatuaGameGrid');
            grid.innerHTML = '';
            const availableGames = getGamesForCurrentMode();

            if (availableGames.length === 0) {
                const emptyMessage = document.createElement('p');
                emptyMessage.className = 'empty-library';
                PlayerLanguage.render(emptyMessage, `No ${currentMode.toLowerCase()} games are currently available.`);
                grid.appendChild(emptyMessage);
                return;
            }

            availableGames.forEach(game => {
                const button = document.createElement('button');
                button.className = 'game-grid-btn accessible-target';
                button.setAttribute('aria-label', game.name);
                const name = document.createElement('span');
                name.id = `game-name-${game.id}`;
                button.setAttribute('aria-labelledby', name.id);
                renderGameMetadata(name, game, 'name', game.name);
                button.appendChild(name);
                if (game.description) {
                    const description = document.createElement('small');
                    description.className = 'game-card-description';
                    description.id = `game-description-${game.id}`;
                    button.setAttribute('aria-describedby', description.id);
                    renderGameMetadata(description, game, 'description', game.description);
                    button.appendChild(description);
                }
                button.setAttribute('data-speech', `${game.name}. ${game.description || currentMode + ' exercise'}`);
                button.addEventListener('click', () => handleAccessibleClick(button, () => startGame(game.id)));
                grid.appendChild(button);
            });
        }

        function renderGameMetadata(element, game, field, fallback) {
            if (game?.[`${field}Mi`] && game.languageApproval === 'approved') {
                const key = `game:${game.id}:${field}`;
                PlayerLanguage.resources[key] = { en: game[field] || fallback, mi: game[`${field}Mi`], status: 'approved' };
                PlayerLanguage.render(element, key);
            } else {
                delete element.dataset.languageKey;
                element.textContent = game?.[field] || fallback;
                element.lang = 'en';
                element.setAttribute('aria-label', element.textContent);
                element.setAttribute('title', element.textContent);
            }
        }

        // Start Game
        function startGame(gameNumber) {
            currentGameNumber = gameNumber;
            const selectedGame = gameLibrary.find(game => game.id === gameNumber);
            const selectedGameName = selectedGame ? selectedGame.name : `Game ${gameNumber}`;
            const selectedVideoSrc = selectedGame && selectedGame.videoSrc
                ? selectedGame.videoSrc
                : DEFAULT_VIDEO_SRC;
            renderGameMetadata(document.getElementById('gameTitleDisplay'), selectedGame, 'name', selectedGameName);
            goToScreen('screen-game');

            resetMovementScore();

            isGameRunning = true;
            isGamePaused = true;
            isGameReady = true;
            PlayerLanguage.render(btnPauseGame, 'Start');
            isFullscreenActive = true;
            renderGameLayout();
            timelineDragging = seekPending = false;
            btnPauseGame.style.background = '#00E676';
            PlayerLanguage.render(document.getElementById('pauseOverlayTitle'), 'Ready when you are');
            PlayerLanguage.render(document.getElementById('pauseOverlayHint'), 'Get comfortable, turn the camera on, then press Start');
            pauseOverlay.classList.add('active');
            avatarSvg.classList.add('paused');
            avatarPose.setMode(currentMode);
            setPosePreview(false);
            void preparePoseScoring(selectedGame);

            // Reset video to start
            if (videoSourceEl.getAttribute('src') !== selectedVideoSrc) {
                videoSourceEl.setAttribute('src', selectedVideoSrc);
                videoEl.load();
            }
            playbackSpeed.value = '1';
            videoEl.playbackRate = 1;
            seekVideo(0);
            updateVideoTimeline();
            videoEl.pause();
            updateMovementFeedback('Get ready — press Start when comfortable');

            if (isVoiceMode) {
                speak('{mode} {gameName}. Get ready, then press Start.', true, { mode: currentMode, gameName: selectedGameName });
            }
        }

        function formatVideoTime(timeInSeconds) {
            if (!Number.isFinite(timeInSeconds) || timeInSeconds < 0) return '00:00';
            const wholeSeconds = Math.floor(timeInSeconds);
            const mins = Math.floor(wholeSeconds / 60).toString().padStart(2, '0');
            const secs = (wholeSeconds % 60).toString().padStart(2, '0');
            return `${mins}:${secs}`;
        }

        function updateVideoTimeline() {
            if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
                document.getElementById('gameStage').style.setProperty?.('--video-aspect-ratio', String(videoEl.videoWidth / videoEl.videoHeight));
            }
            const duration = Number.isFinite(videoEl.duration) && videoEl.duration > 0
                ? videoEl.duration
                : 0;
            const currentTime = Number.isFinite(videoEl.currentTime) && videoEl.currentTime >= 0
                ? videoEl.currentTime
                : 0;

            videoCurrentTime.textContent = formatVideoTime(currentTime);
            videoDuration.textContent = formatVideoTime(duration);
            videoProgress.max = duration || 1;
            if (!timelineDragging) videoProgress.value = Math.min(currentTime, duration || 0);
            videoProgress.disabled = duration === 0;
        }

        videoEl.addEventListener('timeupdate', updateVideoTimeline);
        videoEl.addEventListener('loadedmetadata', updateVideoTimeline);
        videoEl.addEventListener('durationchange', updateVideoTimeline);

        videoProgress.addEventListener('input', function() {
            const seekTime = Number(videoProgress.value);
            if (Number.isFinite(seekTime) && Number.isFinite(videoEl.duration)) {
                seekVideo(Math.min(Math.max(seekTime, 0), videoEl.duration));
                videoCurrentTime.textContent = formatVideoTime(videoEl.currentTime);
            }
        });

        playbackSpeed.addEventListener('change', function() {
            const selectedSpeed = Number(playbackSpeed.value);
            videoEl.playbackRate = Number.isFinite(selectedSpeed) ? selectedSpeed : 1;
        });

        // Invalidate captures before app assignments and at native seek boundaries.
        // The tracker inference is synchronous; capture context also protects reentrant/late consumers.
        function invalidatePoseComparison() {
            seekGeneration++;
            scoringSession?.resetTransient?.();
            poseTracker?.invalidatePendingPoses();
            avatarPose.reset();
            updateMovementFeedback(isGameReady ? 'Get ready — press Start when comfortable'
                : isGamePaused ? 'Game paused' : cameraEnabled ? 'Follow the movement' : 'Turn camera on to score');
        }
        function beginVideoSeek() {
            seekPending = true;
            invalidatePoseComparison();
        }
        function completeVideoSeek() {
            if (videoEl.seeking || timelineDragging) return;
            invalidatePoseComparison();
            seekPending = false;
        }
        function seekVideo(time) {
            beginVideoSeek();
            videoEl.currentTime = time;
            // Assigning the same position may produce no seeked event.
            if (!videoEl.seeking) completeVideoSeek();
        }
        videoEl.addEventListener('seeking', beginVideoSeek);
        videoEl.addEventListener('seeked', completeVideoSeek);
        videoProgress.addEventListener('pointerdown', () => {
            timelineDragging = true;
            beginVideoSeek();
        });
        const endTimelineDrag = () => { timelineDragging = false; completeVideoSeek(); };
        window.addEventListener('pointerup', endTimelineDrag);
        window.addEventListener('pointercancel', endTimelineDrag);
        videoProgress.addEventListener('change', endTimelineDrag);
        videoProgress.addEventListener('blur', endTimelineDrag);

        // Pause / Resume Game
        function togglePauseGame() {
            if (!isGameRunning) return;

            playbackGeneration++;
            invalidatePoseComparison();
            isGamePaused = !isGamePaused;
            if (isGamePaused) {
                if (cameraEnabled) poseTracker?.pauseProcessing();
                avatarPose.reset();
                updateMovementFeedback('Game paused');
                videoEl.pause();
                avatarSvg.classList.add('paused');
                PlayerLanguage.render(document.getElementById('pauseOverlayTitle'), 'GAME PAUSED');
                PlayerLanguage.render(document.getElementById('pauseOverlayHint'), 'Press Resume when you are ready');
                pauseOverlay.classList.add('active');
                PlayerLanguage.render(btnPauseGame, 'Resume');
                btnPauseGame.style.background = '#00E676';
                if (isVoiceMode) speak("Game Paused");
            } else {
                const firstStart = isGameReady;
                isGameReady = false;
                const token = ++playbackGeneration;
                videoEl.play().then(() => {
                    if (token !== playbackGeneration && (!isGameRunning || isGamePaused)) videoEl.pause();
                }).catch(error => {
                    if (token === playbackGeneration && isGameRunning && !isGamePaused) togglePauseGame();
                    console.warn('Game playback could not start', error);
                });
                if (cameraEnabled) poseTracker?.resumeProcessing();
                updateMovementFeedback(cameraEnabled ? 'Follow the movement' : 'Turn camera on to score');
                avatarSvg.classList.remove('paused');
                pauseOverlay.classList.remove('active');
                PlayerLanguage.render(btnPauseGame, 'Pause');
                btnPauseGame.style.background = 'var(--color-pause)';
                if (isVoiceMode) speak(firstStart ? "Let's move!" : "Game Resumed");
            }
        }

        function renderGameLayout() {
            const stage = document.getElementById('gameStage');
            stage.classList.toggle('fullscreen-active', isFullscreenActive);
            avatarPanel.setAttribute('aria-hidden', String(isFullscreenActive));
            PlayerLanguage.render(btnFullscreenToggle, isFullscreenActive ? 'Show User Avatar' : 'Full Screen');
            btnFullscreenToggle.setAttribute('aria-expanded', String(!isFullscreenActive));
            btnFullscreenToggle.setAttribute('aria-controls', 'avatarPanel');
        }
        function toggleFullscreenMode() {
            isFullscreenActive = !isFullscreenActive;
            renderGameLayout();
            if (isVoiceMode) speak(isFullscreenActive ? 'Full Screen mode enabled' : 'User avatar shown');
        }

        // Finish Game -> Win Screen
        function finishGame() {
            stopGameSession();
            finalScoreVal.innerText = currentScore;
            goToScreen('screen-win');
        }

        // Quit Game -> Playlist
        function quitGame() {
            stopGameSession();
            goToScreen('screen-playlist');
        }

        // Restart Current Game
        function restartGame() {
            startGame(currentGameNumber);
        }

        // Continue to Next Game
        function continueNextGame() {
            const availableGames = getGamesForCurrentMode();
            if (availableGames.length === 0) {
                goToScreen('screen-playlist');
                return;
            }
            const currentIndex = availableGames.findIndex(game => game.id === currentGameNumber);
            const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % availableGames.length;
            startGame(availableGames[nextIndex].id);
        }

        // Stop session cleanly
        function stopGameSession() {
            playbackGeneration++;
            seekGeneration++;
            timelineDragging = seekPending = false;
            scoringLoadToken++;
            scoringSession = null;
            stopPlayerTracking();
            isGameRunning = false;
            isGamePaused = false;
            videoEl.pause();
        }

        // When video ends automatically
        videoEl.addEventListener('ended', function() {
            if (isGameRunning) {
                finishGame();
            }
        });

        /* ---------------------------------------------------- */
        /* STAFF PROTOTYPE WORKFLOW                              */
        /* ---------------------------------------------------- */
        function openStaffLogin() {
            document.getElementById('staffLoginForm').reset();
            document.getElementById('staffLoginMessage').textContent = '';
            goToScreen('screen-staff-login');
        }

        /*
         * Prototype-only authentication.
         * This is not secure and would be replaced with server-side
         * authentication in a production system.
         */
        function handleStaffLogin(event) {
            event.preventDefault();
            const username = document.getElementById('staffUsername').value.trim();
            const password = document.getElementById('staffPassword').value;
            const message = document.getElementById('staffLoginMessage');

            if (!username || !password) {
                message.textContent = 'Please enter both the username and password.';
                return;
            }

            if (username !== 'staff' || password !== '123') {
                message.textContent = 'Incorrect username or password. Please use the demo account shown above.';
                return;
            }

            message.textContent = '';
            document.getElementById('staffLoginForm').reset();
            goToScreen('screen-staff-dashboard');
        }

        function logoutStaff() {
            clearInterval(processingInterval);
            resetRecording();
            selectedVideoFileName = '';
            document.getElementById('staffLoginForm').reset();
            document.getElementById('staffLoginMessage').textContent = '';
            goToScreen('screen-start');
        }

        function openStaffLibrary() {
            cancelGameEdit();
            document.getElementById('libraryStatusMessage').textContent = '';
            renderStaffGameLibrary();
            goToScreen('screen-staff-library');
        }

        function renderStaffGameLibrary() {
            const list = document.getElementById('staffGameList');
            list.innerHTML = '';

            if (gameLibrary.length === 0) {
                const emptyMessage = document.createElement('div');
                emptyMessage.className = 'empty-library';
                emptyMessage.textContent = 'The prototype game library is empty.';
                list.appendChild(emptyMessage);
                return;
            }

            gameLibrary.forEach(game => {
                const item = document.createElement('article');
                item.className = 'library-item';

                const details = document.createElement('div');
                const heading = document.createElement('h3');
                const metadata = document.createElement('p');
                heading.textContent = game.name;
                metadata.textContent = `${game.mode} · ${game.description || 'No description'}`;
                details.append(heading, metadata);

                const actions = document.createElement('div');
                actions.className = 'staff-actions';
                const editButton = document.createElement('button');
                editButton.className = 'staff-btn';
                editButton.type = 'button';
                editButton.textContent = 'Edit';
                editButton.addEventListener('click', () => beginGameEdit(game.id));

                const deleteButton = document.createElement('button');
                deleteButton.className = 'staff-btn danger';
                deleteButton.type = 'button';
                deleteButton.textContent = 'Delete';
                deleteButton.addEventListener('click', () => deleteGame(game.id));
                actions.append(editButton, deleteButton);

                item.append(details, actions);
                list.appendChild(item);
            });
        }

        function beginGameEdit(gameId) {
            const game = gameLibrary.find(item => item.id === gameId);
            if (!game) return;

            document.getElementById('editGameId').value = game.id;
            document.getElementById('editGameName').value = game.name;
            document.getElementById('editGameMode').value = game.mode;
            document.getElementById('editGameDescription').value = game.description;
            document.getElementById('editGamePanel').classList.add('active');
            document.getElementById('editGameName').focus();
        }

        async function saveGameEdit(event) {
            event.preventDefault();
            const gameId = Number(document.getElementById('editGameId').value);
            const game = gameLibrary.find(item => item.id === gameId);
            if (!game) return;

            if (game.persistent) {
                try {
                    Object.assign(game, await localApi(`/api/games/${game.id}`, { method: 'POST', body: JSON.stringify({
                        name: document.getElementById('editGameName').value.trim(),
                        mode: document.getElementById('editGameMode').value,
                        description: document.getElementById('editGameDescription').value.trim()
                    }) }));
                } catch (error) { document.getElementById('libraryStatusMessage').textContent = error.message; return; }
            }
            game.name = document.getElementById('editGameName').value.trim();
            game.mode = document.getElementById('editGameMode').value;
            game.description = document.getElementById('editGameDescription').value.trim();
            cancelGameEdit();
            renderStaffGameLibrary();
            document.getElementById('libraryStatusMessage').textContent = 'Game details updated.';
        }

        function cancelGameEdit() {
            document.getElementById('editGamePanel').classList.remove('active');
        }

        async function deleteGame(gameId) {
            const gameIndex = gameLibrary.findIndex(item => item.id === gameId);
            if (gameIndex < 0) return;
            const gameName = gameLibrary[gameIndex].name;
            if (!window.confirm(`Delete “${gameName}” from the library?`)) return;

            if (gameLibrary[gameIndex].persistent) {
                try { await localApi(`/api/games/${gameId}`, { method: 'DELETE' }); }
                catch (error) { document.getElementById('libraryStatusMessage').textContent = error.message; return; }
            }
            gameLibrary.splice(gameIndex, 1);
            cancelGameEdit();
            renderStaffGameLibrary();
            document.getElementById('libraryStatusMessage').textContent = `${gameName} deleted.`;
        }

        function openAddGame() {
            clearInterval(processingInterval);
            resetRecording();
            goToScreen('screen-add-game');
        }

        function openUploadVideo() {
            selectedVideoFile = null;
            processedVideoSrc = null;
            selectedVideoFileName = '';
            document.getElementById('videoFileInput').value = '';
            document.getElementById('selectedVideoName').textContent = 'No file selected';
            document.getElementById('uploadContinueBtn').disabled = true;
            goToScreen('screen-upload-video');
        }

        function handleVideoFileSelected(event) {
            const file = event.target.files[0];
            selectedVideoFile = file || null;
            processedVideoSrc = null;
            selectedVideoFileName = file ? file.name : '';
            document.getElementById('selectedVideoName').textContent = file
                ? `Selected: ${file.name}`
                : 'No file selected';
            document.getElementById('uploadContinueBtn').disabled = !file;
        }

        function openRecordVideo() {
            selectedVideoFile = null;
            processedVideoSrc = null;
            selectedVideoFileName = '';
            resetRecording();
            goToScreen('screen-record-video');
        }

        function formatRecordingTime(totalSeconds) {
            const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
            const secs = (totalSeconds % 60).toString().padStart(2, '0');
            return `${mins}:${secs}`;
        }

        let staffRecorder = null;
        let recorderLoadToken = 0;

        function renderRecordingState(state, message) {
            document.getElementById('recordStatus').textContent = message;
            document.getElementById('recordingIndicator').classList.toggle('active', state === 'recording');
            document.getElementById('startRecordBtn').disabled = !['idle', 'error'].includes(state);
            document.getElementById('stopRecordBtn').disabled = state !== 'recording';
            document.getElementById('retakeRecordBtn').disabled = state === 'idle';
            document.getElementById('recordContinueBtn').disabled = state !== 'ready';
            document.getElementById('recordAudio').disabled = ['starting', 'recording', 'saving'].includes(state);
            if (state !== 'ready') document.getElementById('recordDownload').hidden = true;
        }

        async function startRecording() {
            const request = ++recorderLoadToken;
            renderRecordingState('starting', 'Preparing camera…');
            try {
                const module = await import('./video-recorder.js');
                if (request !== recorderLoadToken) return;
                staffRecorder ??= module.createVideoRecorder({
                    video: document.getElementById('recordVideoPreview'),
                    onState: renderRecordingState,
                    onTime: seconds => { document.getElementById('recordTimer').textContent = formatRecordingTime(seconds); },
                    normalize: module.normalizeRecording,
                    onComplete(file, url) {
                        selectedVideoFile = file;
                        selectedVideoFileName = file.name;
                        const download = document.getElementById('recordDownload');
                        download.href = url; download.download = file.name; download.hidden = false;
                    }
                });
                await staffRecorder.start({ audio: document.getElementById('recordAudio').checked });
            } catch (error) { renderRecordingState('error', error.message); }
        }

        function stopRecording() { staffRecorder?.stop(); }

        function resetRecording() {
            ++recorderLoadToken;
            staffRecorder?.reset();
            selectedVideoFile = null;
            selectedVideoFileName = '';
            document.getElementById('recordTimer').textContent = '00:00';
            renderRecordingState('idle', 'Ready to record');
        }

        function leaveRecordScreen() {
            resetRecording();
            goToScreen('screen-add-game');
        }

        function beginProcessing(sourceLabel) {
            extractionMode = document.getElementById(sourceLabel === 'Recorded video' ? 'recordBodyMode' : 'uploadBodyMode').value;
            clearInterval(processingInterval);
            let progress = 0;
            const progressBar = document.getElementById('processingProgress');
            const progressTrack = progressBar.parentElement;
            const stepLabels = document.querySelectorAll('.processing-steps span');
            const continueButton = document.getElementById('processingContinueBtn');
            document.getElementById('processingTitle').textContent = `Processing ${sourceLabel.toLowerCase()}…`;
            progressBar.style.width = '0%';
            progressTrack.setAttribute('aria-valuenow', '0');
            stepLabels.forEach(step => step.classList.remove('active'));
            continueButton.disabled = true;
            goToScreen('screen-processing');

            const frame = document.getElementById('stylizerFrame');
            frame.hidden = !selectedVideoFile;
            progressTrack.hidden = !!selectedVideoFile;
            document.querySelector('.processing-steps').hidden = !!selectedVideoFile;
            if (selectedVideoFile) {
                processedVideoSrc = null;
                processedReferenceSrc = null;
                processingFailed = false;
                extractUploadedMovement(selectedVideoFile);
                frame.src = 'video_style/index.html?embedded=1';
                return;
            }
            processingInterval = setInterval(() => {
                progress = Math.min(progress + 5, 100);
                progressBar.style.width = `${progress}%`;
                progressTrack.setAttribute('aria-valuenow', progress);
                const activeStep = Math.min(Math.floor(progress / 25), stepLabels.length - 1);
                stepLabels.forEach((step, index) => step.classList.toggle('active', index <= activeStep));

                if (progress === 100) {
                    clearInterval(processingInterval);
                    document.getElementById('processingTitle').textContent = 'Game preparation complete';
                    continueButton.disabled = false;
                }
            }, 180);
        }

        function cancelProcessing() {
            document.getElementById('stylizerFrame').src = 'about:blank';
            processedVideoSrc = null;
            clearInterval(processingInterval);
            goToScreen('screen-add-game');
        }

        function openPublishScreen() {
            const defaultName = selectedVideoFileName
                ? selectedVideoFileName.replace(/\.[^.]+$/, '')
                : 'New Recorded Game';
            document.getElementById('publishGameForm').reset();
            document.getElementById('publishGameMode').value = selectedVideoFile ? extractionMode : 'Seated';
            document.getElementById('publishGameMode').disabled = !!selectedVideoFile;
            document.getElementById('publishGameName').value = defaultName;
            document.getElementById('publishMessage').textContent = '';
            goToScreen('screen-publish-game');
        }

        async function publishGame(event) {
            event.preventDefault();
            if (selectedVideoFile && (!processedVideoSrc || !processedReferenceSrc || processingFailed)) {
                document.getElementById('publishMessage').textContent = 'Complete video and movement processing first.';
                return;
            }
            const name = document.getElementById('publishGameName').value.trim();
            if (!name) {
                document.getElementById('publishMessage').textContent = 'Please enter a game name.';
                return;
            }

            const button = event.target.querySelector('button[type="submit"]');
            button.disabled = true;
            document.getElementById('publishMessage').textContent = 'Saving video and movement guide to your local library…';
            try {
                const payload = {
                    name, mode: document.getElementById('publishGameMode').value,
                    description: document.getElementById('publishGameDescription').value.trim(),
                    videoSrc: DEFAULT_VIDEO_SRC, referencePoseSrc: DEFAULT_REFERENCE_POSE_SRC
                };
                if (processedVideoSrc) {
                    const [video, reference] = await Promise.all([
                        fetch(processedVideoSrc).then(r => r.blob()), fetch(processedReferenceSrc).then(r => r.json())
                    ]);
                    payload.video = await blobBase64(video);
                    payload.reference = reference;
                }
                const game = await localApi('/api/games', { method: 'POST', body: JSON.stringify(payload) });
                gameLibrary.push(game);
            } catch (error) {
                document.getElementById('publishMessage').textContent = `Could not save: ${error.message}. Try again.`;
                return;
            } finally { button.disabled = false; }
            selectedVideoFileName = '';
            openStaffLibrary();
            document.getElementById('libraryStatusMessage').textContent = `${name} published to the prototype library.`;
        }

        /* ---------------------------------------------------- */
        /* ACCESSIBILITY & DUAL-ACTION VOICE GUIDANCE ENGINE    */
        /* ---------------------------------------------------- */
        let subtitleTimer = null;

        function toggleInterfaceLanguage() {
            clearVoiceFocus();
            PlayerLanguage.setLanguage(PlayerLanguage.interfaceLanguage === 'en' ? 'mi' : 'en');
        }

        function renderVoiceState() {
            document.querySelectorAll('.voice-icon-btn').forEach(button => {
                button.classList.toggle('active', isVoiceMode);
                button.setAttribute('aria-pressed', String(isVoiceMode));
                PlayerLanguage.render(button, isVoiceMode ? 'Voice Guidance: ON' : 'Voice Guidance: OFF');
            });
            document.getElementById('voiceEnglish').setAttribute('aria-pressed', String(isVoiceMode && voiceLanguage === 'en'));
            document.getElementById('voiceMaori').setAttribute('aria-pressed', String(isVoiceMode && voiceLanguage === 'mi'));
        }
        function toggleVoiceMode() {
            voiceReturnFocus = document.activeElement;
            clearVoiceFocus();
            document.getElementById('voiceLanguageDialog').showModal();
            document.getElementById('voiceEnglish').focus();
            renderMaoriVoiceNotice();
            speak('Choose voice language. English. Māori.');
        }
        function closeVoicePanel(returnFocus = true) {
            const dialog = document.getElementById('voiceLanguageDialog');
            if (dialog.open) dialog.close();
            clearVoiceFocus();
            if (returnFocus) voiceReturnFocus?.focus();
        }
        function selectVoiceLanguage(language) {
            clearVoiceFocus();
            voiceLanguage = language;
            isVoiceMode = true;
            renderVoiceState();
            closeVoicePanel();
            speak(voiceLanguage === 'mi' && !preferredMaoriVoice
                ? 'No Māori voice is available on this device. You can select Māori with text prompts, or choose English for audio.'
                : 'Voice Guidance Mode Enabled. Tap any button once to hear its name, tap again to activate.');
        }
        function turnVoiceOff() {
            isVoiceMode = false;
            renderVoiceState();
            closeVoicePanel();
            speak('Voice Guidance Mode Disabled.');
        }

        // Dual action click handler
        function handleAccessibleClick(element, actionCallback) {
            if (!isVoiceMode || element.closest('.staff-screen, .role-staff')) {
                // Direct activation in standard mode
                actionCallback();
                return;
            }

            // Voice Guidance Mode logic
            if (currentFocusedButton === element) {
                // Second click confirms and triggers action
                clearVoiceFocus();
                actionCallback();
            } else {
                // First click speaks and focuses
                clearVoiceFocus();
                currentFocusedButton = element;
                element.classList.add('voice-focused');

                const key = element.dataset.speechKey || element.dataset.languageKey;
                const speechPrompt = key ? PlayerLanguage.speech(key, voiceLanguage, element._languageValues) : element.getAttribute('data-speech') || element.innerText.trim();
                const guidanceMessage = `${speechPrompt || element.getAttribute('data-speech')}. ${PlayerLanguage.speech('Tap again to confirm.', voiceLanguage) || 'Tap again to confirm.'}`;

                const subtitleKey = `prompt:${key || speechPrompt}`;
                const resource = PlayerLanguage.entry(key || speechPrompt);
                PlayerLanguage.resources[subtitleKey] = {
                    en: `${resource.speechEn || resource.en}. ${PlayerLanguage.entry('Tap again to confirm.').en}`,
                    mi: resource.mi ? `${resource.speechMi || resource.mi} ${PlayerLanguage.entry('Tap again to confirm.').mi}` : '',
                    status: resource.status, speechStatus: resource.speechStatus, speechEn: guidanceMessage
                };
                speak(subtitleKey, true, element._languageValues);
            }
        }

        function clearVoiceFocus() {
            speechGeneration++;
            window.speechSynthesis?.cancel();
            if (currentFocusedButton) {
                currentFocusedButton.classList.remove('voice-focused');
                currentFocusedButton = null;
            }
            hideSubtitle();
        }

        function showSubtitle(text) {
            clearTimeout(subtitleTimer);
            const sub = document.getElementById('voice-subtitle');
            if (sub) {
                PlayerLanguage.render(sub, text);
                sub.style.display = 'block';
            }
        }

        function hideSubtitle() {
            clearTimeout(subtitleTimer);
            const sub = document.getElementById('voice-subtitle');
            if (sub) {
                sub.style.display = 'none';
            }
        }

        // English Voice selector for robust cross-device compatibility (iPad, Android, Windows, Mac)
        let preferredEnglishVoice = null;
        let preferredMaoriVoice = null;
        function renderMaoriVoiceNotice() {
            const notice = document.getElementById('maoriVoiceNotice');
            notice.hidden = Boolean(preferredMaoriVoice);
            if (!notice.hidden) PlayerLanguage.render(notice, 'No Māori voice is available on this device. You can select Māori with text prompts, or choose English for audio.');
        }

        function initEnglishVoice() {
            if ('speechSynthesis' in window) {
                const voices = window.speechSynthesis.getVoices();
                preferredMaoriVoice = voices.find(voice => /^mi(?:-|$)/i.test(voice.lang)) || null;
                if (voices && voices.length > 0) {
                    // Priority: en-NZ > en-AU > en-GB > en-US > any English voice
                    preferredEnglishVoice = voices.find(v => v.lang === 'en-NZ') ||
                                           voices.find(v => v.lang === 'en-AU') ||
                                           voices.find(v => v.lang === 'en-GB') ||
                                           voices.find(v => v.lang === 'en-US') ||
                                           voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'));
                }
            }
            renderMaoriVoiceNotice();
        }

        if ('speechSynthesis' in window) {
            initEnglishVoice();
            window.speechSynthesis.onvoiceschanged = initEnglishVoice;
        }

        // Convert any numbers to English words so multilingual voices will NEVER read digits in Chinese
        function formatTextForEnglishSpeech(text) {
            const digitMap = {
                '1': 'One', '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five',
                '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine', '0': 'Zero',
                '180': 'one hundred and eighty'
            };
            return text.replace(/\b(180|[0-9])\b/g, (match) => digitMap[match] || match);
        }

        // Text-to-Speech Engine with 100% synchronized subtitle
        function speak(key, showSub = true, values = {}) {
            const text = PlayerLanguage.speech(key, voiceLanguage, values);
            if (!text) {
                if (showSub) showSubtitle(key);
                return;
            }
            const token = ++speechGeneration;
            if (showSub) {
                showSubtitle(key);
                PlayerLanguage.render(document.getElementById('voice-subtitle'), key, values);
            }
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel(); // Cancel any ongoing speech
                if (voiceLanguage === 'mi' && !preferredMaoriVoice) {
                    if (showSub && !currentFocusedButton) subtitleTimer = setTimeout(hideSubtitle, 6000);
                    return; // Keep Māori selected; never substitute an English voice.
                }

                // Ensure English words for all digits
                const spokenText = voiceLanguage === 'mi' ? text : formatTextForEnglishSpeech(text);
                const utterance = new SpeechSynthesisUtterance(spokenText);
                utterance.rate = 0.92; // Clear and accessible pace
                utterance.pitch = 1.0;

                // If a native English voice is available, assign it explicitly
                if (!preferredEnglishVoice) {
                    initEnglishVoice();
                }
                if (voiceLanguage === 'mi') {
                    utterance.voice = preferredMaoriVoice;
                    utterance.lang = preferredMaoriVoice.lang;
                } else if (preferredEnglishVoice) {
                    utterance.voice = preferredEnglishVoice;
                    utterance.lang = preferredEnglishVoice.lang;
                } else {
                    utterance.lang = 'en-US'; // Universal fallback
                }

                utterance.onend = function() {
                    if (token === speechGeneration && !currentFocusedButton) {
                        clearTimeout(subtitleTimer);
                        subtitleTimer = setTimeout(() => {
                            hideSubtitle();
                        }, 2000);
                    }
                };

                window.speechSynthesis.speak(utterance);
            }
        }

        // Click on background cancels voice focus
        document.getElementById('screen-container').addEventListener('click', function(e) {
            if (!e.target.closest('.accessible-target')) {
                clearVoiceFocus();
            }
        });

        /* ---------------------------------------------------- */
        /* CELEBRATION CONFETTI EFFECT                          */
        /* ---------------------------------------------------- */
        function triggerConfetti() {
            const canvas = document.getElementById('winConfettiCanvas');
            const ctx = canvas.getContext('2d');
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;

            const particles = [];
            const colors = ['#FF5722', '#FFD600', '#00E676', '#00BCD4', '#E040FB', '#FF4081'];

            for (let i = 0; i < 70; i++) {
                particles.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * -canvas.height,
                    size: Math.random() * 10 + 6,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    speedY: Math.random() * 3 + 2,
                    speedX: (Math.random() - 0.5) * 3,
                    rotation: Math.random() * 360,
                    rotSpeed: (Math.random() - 0.5) * 10
                });
            }

            let animationFrameId;
            let start = Date.now();

            function draw() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                particles.forEach(p => {
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate((p.rotation * Math.PI) / 180);
                    ctx.fillStyle = p.color;
                    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                    ctx.restore();

                    p.y += p.speedY;
                    p.x += p.speedX;
                    p.rotation += p.rotSpeed;

                    if (p.y > canvas.height) {
                        p.y = -10;
                        p.x = Math.random() * canvas.width;
                    }
                });

                if (Date.now() - start < 4000) {
                    animationFrameId = requestAnimationFrame(draw);
                } else {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    cancelAnimationFrame(animationFrameId);
                }
            }

            draw();
        }

        window.addEventListener('message', event => {
            const frame = document.getElementById('stylizerFrame');
            if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.source !== 'video-stylizer') return;
            if (!document.getElementById('screen-processing').classList.contains('active')) return;
            if (event.data.type === 'ready' && selectedVideoFile) {
                frame.contentWindow.postMessage({ type: 'stylize', file: selectedVideoFile }, location.origin);
            } else if (event.data.type === 'status') {
                document.getElementById('processingTitle').textContent = event.data.message;
            } else if (event.data.type === 'complete' && event.data.blob instanceof Blob) {
                processedVideoSrc = URL.createObjectURL(event.data.blob);
                updateProcessingReady();
            }
        });

        async function localApi(url, options = {}) {
            if (browserOnly) return (await browserLibraryModule).libraryApi(url, options);
            const response = await fetch(url, options);
            if (!response.headers.get('content-type')?.includes('application/json')) {
                throw new Error('Local storage requires the local app server on port 8001. Use the Open local library version link below.');
            }
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Local library unavailable');
            return data;
        }
        function blobBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = () => reject(new Error('Could not read video data'));
                reader.readAsDataURL(blob);
            });
        }
        async function loadLocalLibrary() {
            const { games } = await localApi('/api/games');
            for (let index = gameLibrary.length - 1; index >= 0; index--) {
                if (gameLibrary[index].persistent) gameLibrary.splice(index, 1);
            }
            gameLibrary.push(...games);
            renderKaumatuaGameLibrary();
            renderStaffGameLibrary();
        }
        async function openLibrarySettings() {
            goToScreen('screen-library-settings');
            const localLink = document.getElementById('libraryServerLink');
            localLink.href = `http://127.0.0.1:8001/${location.search}`;
            localLink.hidden = true;
            document.getElementById('libraryPath').readOnly = browserOnly;
            document.getElementById('libraryFolderHelp').textContent = browserOnly
                ? 'Choose a folder on this device. Save and Load reconnects it after reopening the browser. Your videos stay on this device.'
                : 'Choose a folder or enter a full folder path. Switching leaves previous files in place.';
            try {
                const settings = await localApi('/api/settings');
                document.getElementById('libraryPath').value = settings.libraryPath;
                document.getElementById('librarySettingsStatus').textContent = '';
            } catch (error) { document.getElementById('librarySettingsStatus').textContent = error.message; }
        }
        async function saveLibrarySettings(event) {
            event.preventDefault();
            const status = document.getElementById('librarySettingsStatus');
            const button = event.target.querySelector('button[type="submit"]');
            button.disabled = true;
            try {
                if (browserOnly) await (await browserLibraryModule).authorizeDirectory();
                const settings = await localApi('/api/settings', { method: browserOnly ? undefined : 'POST', body: browserOnly ? undefined : JSON.stringify({
                    libraryPath: document.getElementById('libraryPath').value
                }) });
                referencePoseCache.clear();
                await loadLocalLibrary();
                status.textContent = `Library loaded from ${settings.libraryPath}`;
            } catch (error) { status.textContent = `Could not change library: ${error.message}`; }
            finally { button.disabled = false; }
        }
        if (typeof fetch === 'function') loadLocalLibrary().catch(error => {
            console.warn('Local library could not load', error);
            document.getElementById('libraryStatusMessage').textContent = browserOnly ? 'Choose or reconnect your local library in Game Library → Settings.' : 'Local library unavailable. Check the local server.';
        });

        async function chooseLibraryFolder() {
            const button = document.getElementById('chooseLibraryFolderBtn');
            const status = document.getElementById('librarySettingsStatus');
            button.disabled = true;
            status.textContent = 'Choose a library folder…';
            try {
                const result = browserOnly
                    ? await (await browserLibraryModule).chooseDirectory()
                    : await localApi('/api/library-folder-picker', { method: 'POST' });
                if (result.libraryPath) {
                    document.getElementById('libraryPath').value = result.libraryPath;
                    status.textContent = 'Folder selected. Click Save and Load Library to apply.';
                } else { status.textContent = 'Folder selection cancelled.'; }
            } catch (error) { status.textContent = error.name === 'AbortError' ? 'Folder selection cancelled.' : error.message; }
            finally { button.disabled = false; }
        }

        document.querySelectorAll('[data-language-key]').forEach(element => PlayerLanguage.render(element, element.dataset.languageKey));
        PlayerLanguage.setLanguage('en');
        document.getElementById('voiceLanguageDialog').addEventListener('cancel', event => {
            event.preventDefault(); closeVoicePanel();
        });
        renderVoiceState();
