        /* ---------------------------------------------------- */
        /* APPLICATION STATE & LOGIC                            */
        /* ---------------------------------------------------- */
        let isVoiceMode = false;
        let currentFocusedButton = null;
        let currentMode = 'Seated'; // 'Seated' or 'Standing'
        let currentGameNumber = 1;
        let isGameRunning = false;
        let isGamePaused = false;
        let isFullscreenActive = false;
        let currentScore = 180;
        let nextGameId = 7;
        let selectedVideoFileName = '';
        let recordingInterval = null;
        let recordingSeconds = 0;
        let processingInterval = null;

        const DEFAULT_VIDEO_SRC = 'assets/videos/e9d87196a2d98e530ab1ddebd7c56c5e.mp4';

        // In-memory prototype library. Changes intentionally disappear on refresh.
        const gameLibrary = [
            { id: 1, name: 'Game 1', mode: 'Both', description: 'Gentle Upper Body', videoSrc: DEFAULT_VIDEO_SRC },
            { id: 2, name: 'Game 2', mode: 'Both', description: 'Arm Reach and Stretch', videoSrc: DEFAULT_VIDEO_SRC },
            { id: 3, name: 'Game 3', mode: 'Both', description: 'Shoulder Twist and Wave', videoSrc: DEFAULT_VIDEO_SRC },
            { id: 4, name: 'Game 4', mode: 'Both', description: 'Core Stability', videoSrc: DEFAULT_VIDEO_SRC },
            { id: 5, name: 'Game 5', mode: 'Both', description: 'Side Tap Rhythm', videoSrc: DEFAULT_VIDEO_SRC },
            { id: 6, name: 'Game 6', mode: 'Both', description: 'Gentle Cool Down', videoSrc: DEFAULT_VIDEO_SRC }
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

        let poseTracker = null;
        let poseModule = null;
        let poseSession = 0;
        let poseDebugTimer = null;
        let cameraEnabled = false;
        const cameraToggle = document.getElementById('cameraToggle');
        const avatarPanel = document.getElementById('avatarPanel');
        const avatarPose = createAvatarPoseController(avatarSvg);
        const trackingStatus = document.getElementById('trackingStatus');
        const poseDebug = new URLSearchParams(location.search).get('poseDebug') === '1';
        const poseDebugPanel = document.getElementById('poseDebugPanel');

        function renderPoseDiagnostics() {
            if (!poseDebug) return;
            poseDebugPanel.hidden = false;
            poseDebugPanel.textContent = JSON.stringify(window.playerPoseTracking.getDiagnostics(), null, 2);
        }

        function updateTrackingStatus({ state, message }) {
            if (trackingStatus.textContent !== message) trackingStatus.textContent = message;
            trackingStatus.dataset.state = state;
            avatarPanel.dataset.tracking = state;
            if (state !== 'detected') avatarPose.reset();
            if (state === 'unavailable') {
                cameraEnabled = false;
                clearInterval(poseDebugTimer);
                poseDebugTimer = null;
            }
            const active = cameraEnabled && ['looking', 'detected', 'paused'].includes(state);
            cameraToggle.textContent = cameraEnabled && state === 'starting'
                ? 'Cancel camera start' : active ? 'Camera: ON' : 'Camera: OFF';
            cameraToggle.setAttribute('aria-pressed', String(cameraEnabled));
            cameraToggle.setAttribute('data-speech', cameraEnabled ? 'Turn camera off' : 'Turn camera on');
        }

        function stopPlayerTracking() {
            cameraEnabled = false;
            poseSession++;
            poseTracker?.stop();
            clearInterval(poseDebugTimer);
            poseDebugTimer = null;
            updateTrackingStatus({ state: 'stopped', message: 'Camera off' });
            renderPoseDiagnostics();
        }

        function togglePlayerCamera() {
            if (!isGameRunning) return;
            if (cameraEnabled) stopPlayerTracking();
            else {
                cameraEnabled = true;
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
                        onPose: timestamp => {
                            if (cameraEnabled && isGameRunning && !isGamePaused) {
                                avatarPose.update(poseTracker.getLatestLandmarks(), timestamp);
                            }
                        }
                    });
                }
                const started = poseTracker.start();
                if (poseDebug) poseDebugTimer = setInterval(renderPoseDiagnostics, 1000);
                if (isGamePaused) poseTracker.pauseProcessing();
                await started;
                renderPoseDiagnostics();
            } catch (error) {
                console.warn('Player tracker could not start', error);
                if (session === poseSession && isGameRunning) {
                    updateTrackingStatus({ state: 'unavailable', message: 'Camera unavailable' });
                }
            }
        }

        // Read-only access for future pose consumers and device testing; no session recording.
        window.playerPoseTracking = Object.freeze({
            getLatestLandmarks: () => poseTracker?.getLatestLandmarks() || null,
            getDiagnostics: () => poseTracker?.getDiagnostics() || { state: 'not-loaded' }
        });
        window.addEventListener('pagehide', () => stopGameSession());

        // Screen Navigation
        function goToScreen(screenId) {
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
                    speak(`Congratulations! Your score is ${currentScore} points. Ka Pai!`);
                }
            }
        }

        // Open Playlist for Seated or Standing
        function openPlaylist(mode) {
            currentMode = mode;
            document.getElementById('playlistHeaderTitle').innerText = `${mode} Playlist`;
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
                emptyMessage.textContent = `No ${currentMode.toLowerCase()} games are currently available.`;
                grid.appendChild(emptyMessage);
                return;
            }

            availableGames.forEach(game => {
                const button = document.createElement('button');
                button.className = 'game-grid-btn accessible-target';
                button.textContent = game.name;
                button.setAttribute('data-speech', `${game.name}. ${game.description || currentMode + ' exercise'}`);
                button.addEventListener('click', () => handleAccessibleClick(button, () => startGame(game.id)));
                grid.appendChild(button);
            });
        }

        // Start Game
        function startGame(gameNumber) {
            currentGameNumber = gameNumber;
            const selectedGame = gameLibrary.find(game => game.id === gameNumber);
            const selectedGameName = selectedGame ? selectedGame.name : `Game ${gameNumber}`;
            const selectedVideoSrc = selectedGame && selectedGame.videoSrc
                ? selectedGame.videoSrc
                : DEFAULT_VIDEO_SRC;
            document.getElementById('gameTitleDisplay').textContent = selectedGameName;
            goToScreen('screen-game');

            currentScore = 180;
            gameScoreDisplay.innerText = currentScore;

            isGameRunning = true;
            isGamePaused = false;
            btnPauseGame.innerText = 'Pause';
            pauseOverlay.classList.remove('active');
            avatarSvg.classList.remove('paused');

            // Reset video to start
            if (videoSourceEl.getAttribute('src') !== selectedVideoSrc) {
                videoSourceEl.setAttribute('src', selectedVideoSrc);
                videoEl.load();
            }
            playbackSpeed.value = '1';
            videoEl.playbackRate = 1;
            videoEl.currentTime = 0;
            updateVideoTimeline();
            videoEl.play().catch(e => {
                console.log('Video play triggered:', e);
            });

            if (isVoiceMode) {
                speak(`Starting ${currentMode} ${selectedGameName}. Let's move!`);
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
            const duration = Number.isFinite(videoEl.duration) && videoEl.duration > 0
                ? videoEl.duration
                : 0;
            const currentTime = Number.isFinite(videoEl.currentTime) && videoEl.currentTime >= 0
                ? videoEl.currentTime
                : 0;

            videoCurrentTime.textContent = formatVideoTime(currentTime);
            videoDuration.textContent = formatVideoTime(duration);
            videoProgress.max = duration || 1;
            videoProgress.value = Math.min(currentTime, duration || 0);
            videoProgress.disabled = duration === 0;
        }

        videoEl.addEventListener('timeupdate', updateVideoTimeline);
        videoEl.addEventListener('loadedmetadata', updateVideoTimeline);
        videoEl.addEventListener('durationchange', updateVideoTimeline);

        videoProgress.addEventListener('input', function() {
            const seekTime = Number(videoProgress.value);
            if (Number.isFinite(seekTime) && Number.isFinite(videoEl.duration)) {
                videoEl.currentTime = Math.min(Math.max(seekTime, 0), videoEl.duration);
                videoCurrentTime.textContent = formatVideoTime(videoEl.currentTime);
            }
        });

        playbackSpeed.addEventListener('change', function() {
            const selectedSpeed = Number(playbackSpeed.value);
            videoEl.playbackRate = Number.isFinite(selectedSpeed) ? selectedSpeed : 1;
        });

        // Pause / Resume Game
        function togglePauseGame() {
            if (!isGameRunning) return;

            isGamePaused = !isGamePaused;
            if (isGamePaused) {
                if (cameraEnabled) poseTracker?.pauseProcessing();
                avatarPose.reset();
                videoEl.pause();
                avatarSvg.classList.add('paused');
                pauseOverlay.classList.add('active');
                btnPauseGame.innerText = 'Resume';
                btnPauseGame.style.background = '#00E676';
                if (isVoiceMode) speak("Game Paused");
            } else {
                videoEl.play().catch(e => console.log(e));
                if (cameraEnabled) poseTracker?.resumeProcessing();
                avatarSvg.classList.remove('paused');
                pauseOverlay.classList.remove('active');
                btnPauseGame.innerText = 'Pause';
                btnPauseGame.style.background = 'var(--color-pause)';
                if (isVoiceMode) speak("Game Resumed");
            }
        }

        // Toggle Full Screen View
        function toggleFullscreenMode() {
            isFullscreenActive = !isFullscreenActive;
            const stage = document.getElementById('gameStage');

            if (isFullscreenActive) {
                stage.classList.add('fullscreen-active');
                btnFullscreenToggle.innerText = 'Exit Full Screen';
                btnFullscreenToggle.style.background = '#ff9800';
                btnFullscreenToggle.setAttribute('data-speech', 'Exit Full Screen to Split Screen');
                if (isVoiceMode) speak("Full Screen mode enabled");
            } else {
                stage.classList.remove('fullscreen-active');
                btnFullscreenToggle.innerText = 'Full Screen';
                btnFullscreenToggle.style.background = 'var(--color-fullscreen)';
                btnFullscreenToggle.setAttribute('data-speech', 'Switch to Full Screen mode');
                if (isVoiceMode) speak("Split Screen mode enabled");
            }
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
            resetSimulatedRecording();
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

        function saveGameEdit(event) {
            event.preventDefault();
            const gameId = Number(document.getElementById('editGameId').value);
            const game = gameLibrary.find(item => item.id === gameId);
            if (!game) return;

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

        function deleteGame(gameId) {
            const gameIndex = gameLibrary.findIndex(item => item.id === gameId);
            if (gameIndex < 0) return;
            const gameName = gameLibrary[gameIndex].name;
            if (!window.confirm(`Delete “${gameName}” from this prototype session?`)) return;

            gameLibrary.splice(gameIndex, 1);
            cancelGameEdit();
            renderStaffGameLibrary();
            document.getElementById('libraryStatusMessage').textContent = `${gameName} deleted.`;
        }

        function openAddGame() {
            clearInterval(processingInterval);
            resetSimulatedRecording();
            goToScreen('screen-add-game');
        }

        function openUploadVideo() {
            selectedVideoFileName = '';
            document.getElementById('videoFileInput').value = '';
            document.getElementById('selectedVideoName').textContent = 'No file selected';
            document.getElementById('uploadContinueBtn').disabled = true;
            goToScreen('screen-upload-video');
        }

        function handleVideoFileSelected(event) {
            const file = event.target.files[0];
            selectedVideoFileName = file ? file.name : '';
            document.getElementById('selectedVideoName').textContent = file
                ? `Selected: ${file.name}`
                : 'No file selected';
            document.getElementById('uploadContinueBtn').disabled = !file;
        }

        function openRecordVideo() {
            selectedVideoFileName = '';
            resetSimulatedRecording();
            goToScreen('screen-record-video');
        }

        function formatRecordingTime(totalSeconds) {
            const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
            const secs = (totalSeconds % 60).toString().padStart(2, '0');
            return `${mins}:${secs}`;
        }

        function startSimulatedRecording() {
            clearInterval(recordingInterval);
            recordingSeconds = 0;
            document.getElementById('recordTimer').textContent = '00:00';
            document.getElementById('recordStatus').textContent = 'Simulated capture in progress';
            document.getElementById('recordingIndicator').classList.add('active');
            document.getElementById('startRecordBtn').disabled = true;
            document.getElementById('stopRecordBtn').disabled = false;
            document.getElementById('retakeRecordBtn').disabled = true;
            document.getElementById('recordContinueBtn').disabled = true;

            recordingInterval = setInterval(() => {
                recordingSeconds++;
                document.getElementById('recordTimer').textContent = formatRecordingTime(recordingSeconds);
            }, 1000);
        }

        function stopSimulatedRecording() {
            if (recordingSeconds === 0) recordingSeconds = 1;
            clearInterval(recordingInterval);
            document.getElementById('recordTimer').textContent = formatRecordingTime(recordingSeconds);
            document.getElementById('recordStatus').textContent = 'Simulated recording ready';
            document.getElementById('recordingIndicator').classList.remove('active');
            document.getElementById('stopRecordBtn').disabled = true;
            document.getElementById('retakeRecordBtn').disabled = false;
            document.getElementById('recordContinueBtn').disabled = false;
        }

        function resetSimulatedRecording() {
            clearInterval(recordingInterval);
            recordingSeconds = 0;
            document.getElementById('recordTimer').textContent = '00:00';
            document.getElementById('recordStatus').textContent = 'Ready to record';
            document.getElementById('recordingIndicator').classList.remove('active');
            document.getElementById('startRecordBtn').disabled = false;
            document.getElementById('stopRecordBtn').disabled = true;
            document.getElementById('retakeRecordBtn').disabled = true;
            document.getElementById('recordContinueBtn').disabled = true;
        }

        function leaveRecordScreen() {
            resetSimulatedRecording();
            goToScreen('screen-add-game');
        }

        function beginProcessing(sourceLabel) {
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
            clearInterval(processingInterval);
            goToScreen('screen-add-game');
        }

        function openPublishScreen() {
            const defaultName = selectedVideoFileName
                ? selectedVideoFileName.replace(/\.[^.]+$/, '')
                : 'New Recorded Game';
            document.getElementById('publishGameForm').reset();
            document.getElementById('publishGameName').value = defaultName;
            document.getElementById('publishMessage').textContent = '';
            goToScreen('screen-publish-game');
        }

        function publishGame(event) {
            event.preventDefault();
            const name = document.getElementById('publishGameName').value.trim();
            if (!name) {
                document.getElementById('publishMessage').textContent = 'Please enter a game name.';
                return;
            }

            gameLibrary.push({
                id: nextGameId++,
                name,
                mode: document.getElementById('publishGameMode').value,
                description: document.getElementById('publishGameDescription').value.trim(),
                videoSrc: DEFAULT_VIDEO_SRC
            });
            selectedVideoFileName = '';
            openStaffLibrary();
            document.getElementById('libraryStatusMessage').textContent = `${name} published to the prototype library.`;
        }

        /* ---------------------------------------------------- */
        /* ACCESSIBILITY & DUAL-ACTION VOICE GUIDANCE ENGINE    */
        /* ---------------------------------------------------- */
        let subtitleTimer = null;

        function toggleVoiceMode() {
            isVoiceMode = !isVoiceMode;

            const voiceButtons = document.querySelectorAll('.voice-icon-btn');
            const voiceStates = document.querySelectorAll('.voice-state');
            const voiceBadges = document.querySelectorAll('.voice-text-badge');

            voiceButtons.forEach(btn => {
                btn.classList.toggle('active', isVoiceMode);
                btn.setAttribute('aria-pressed', String(isVoiceMode));
            });
            voiceStates.forEach(state => state.innerText = isVoiceMode ? "ON" : "OFF");
            voiceBadges.forEach(badge => badge.innerText = isVoiceMode ? "Voice: ON" : "Voice: OFF");

            if (isVoiceMode) {
                const msg = "Voice Guidance Mode Enabled. Tap any button once to hear its name, tap again to activate.";
                speak(msg);
            } else {
                clearVoiceFocus();
                const msg = "Voice Guidance Mode Disabled.";
                speak(msg);
            }
        }

        // Dual action click handler
        function handleAccessibleClick(element, actionCallback) {
            if (!isVoiceMode) {
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

                const speechPrompt = element.getAttribute('data-speech') || element.innerText.trim();
                const guidanceMessage = `${speechPrompt}. Tap again to confirm.`;

                speak(guidanceMessage);
            }
        }

        function clearVoiceFocus() {
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
                sub.innerText = "🔊 " + text;
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

        function initEnglishVoice() {
            if ('speechSynthesis' in window) {
                const voices = window.speechSynthesis.getVoices();
                if (voices && voices.length > 0) {
                    // Priority: en-NZ > en-AU > en-GB > en-US > any English voice
                    preferredEnglishVoice = voices.find(v => v.lang === 'en-NZ') ||
                                           voices.find(v => v.lang === 'en-AU') ||
                                           voices.find(v => v.lang === 'en-GB') ||
                                           voices.find(v => v.lang === 'en-US') ||
                                           voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'));
                }
            }
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
        function speak(text, showSub = true) {
            if (showSub) {
                showSubtitle(text);
            }
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel(); // Cancel any ongoing speech

                // Ensure English words for all digits
                const spokenText = formatTextForEnglishSpeech(text);
                const utterance = new SpeechSynthesisUtterance(spokenText);
                utterance.rate = 0.92; // Clear and accessible pace
                utterance.pitch = 1.0;

                // If a native English voice is available, assign it explicitly
                if (!preferredEnglishVoice) {
                    initEnglishVoice();
                }
                if (preferredEnglishVoice) {
                    utterance.voice = preferredEnglishVoice;
                    utterance.lang = preferredEnglishVoice.lang;
                } else {
                    utterance.lang = 'en-US'; // Universal fallback
                }

                utterance.onend = function() {
                    if (!currentFocusedButton) {
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
