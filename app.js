// State
// Helper for safe parsing
function safeParse(key, def) {
    try {
        return JSON.parse(localStorage.getItem(key)) || def;
    } catch (e) {
        return def;
    }
}

const defaultCategories = ['ОБЩИЕ', 'РАБОТА', 'ДОМ', 'ЛИЧНЫЕ'];

// Data Repair Logic
function validateAndRepairData() {
    let t = safeParse('planner_tasks', []);
    let c = safeParse('planner_categories', defaultCategories);

    // Fix Categories
    if (!Array.isArray(c) || c.length === 0) c = defaultCategories;
    c = c.filter(item => typeof item === 'string' && item.trim() !== '');

    // Fix Tasks
    if (!Array.isArray(t)) t = [];
    t = t.filter(task => task && task.id && task.title);

    // Save back fixed data
    localStorage.setItem('planner_tasks', JSON.stringify(t));
    localStorage.setItem('planner_categories', JSON.stringify(c));

    return { tasks: t, categories: c };
}

const data = validateAndRepairData();
let tasks = data.tasks;
let categories = data.categories;

// Emergency Reset
window.resetApp = () => {
    localStorage.clear();
    location.reload();
};

// DOM Elements
const stackContainer = document.getElementById('category-stack');
const modalAdd = document.getElementById('modal-add-task');
const inputDateNative = document.getElementById('input-date-native');
const labelDate = document.getElementById('label-date');
let selectedDate = null;
let selectedCategory = 'ОБЩИЕ';
let expandedCategory = null;
let currentPhotos = [];
let currentTab = 'home'; // Track active tab
const HEADER_HEIGHT_PX = 50;
const HEADER_HEIGHT_REM = 3;
const TOP_OFFSET_PX = 2; // Raised from 10 to 0

// Undo State
let lastAction = null;
let undoTimeout = null;
let countdownInterval = null;
const UNDO_DELAY = 5000; // 5 seconds

// ===== THEME INITIALIZATION =====
function initTheme() {
    try {
        if (window.Telegram?.WebApp) {
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();

            // Get theme from Telegram
            const colorScheme = tg.colorScheme || 'light';
            document.body.classList.toggle('dark-theme', colorScheme === 'dark');

            // Listen for theme changes
            if (tg.onEvent) {
                tg.onEvent('themeChanged', () => {
                    const newScheme = tg.colorScheme;
                    document.body.classList.toggle('dark-theme', newScheme === 'dark');
                    hapticImpact('light');
                });
            }

            // Set header color
            tg.setHeaderColor(colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F7');

            console.log("Theme initialized:", colorScheme);
        }
    } catch (e) {
        console.warn("Theme init failed:", e);
    }
}

// ===== PULL TO REFRESH =====
let pullStartY = 0;
let pullCurrentY = 0;
let isPulling = false;

function initPullToRefresh() {
    const indicator = document.getElementById('pull-indicator');
    const pullText = document.getElementById('pull-text');
    let isRefreshing = false;

    document.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0 && !isRefreshing) {
            pullStartY = e.touches[0].pageY;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (window.scrollY === 0 && !isRefreshing && pullStartY) {
            pullCurrentY = e.touches[0].pageY;
            const pullDistance = pullCurrentY - pullStartY;

            if (pullDistance > 0) {
                isPulling = true;
                const resistance = Math.min(pullDistance * 0.5, 100);

                if (resistance > 60) {
                    indicator.classList.add('visible');
                    pullText.textContent = 'Отпустите для обновления';
                } else {
                    indicator.classList.remove('visible');
                    pullText.textContent = 'Потяните для обновления';
                }
            }
        }
    }, { passive: true });

    document.addEventListener('touchend', async () => {
        if (isPulling && !isRefreshing) {
            isPulling = false;
            pullStartY = 0;

            if (indicator.classList.contains('visible')) {
                isRefreshing = true;
                indicator.classList.add('refreshing');
                pullText.textContent = 'Обновление...';

                hapticImpact('medium');

                // Force sync with Firebase
                if (tgUserId && db) {
                    try {
                        const ref = db.ref('users/' + tgUserId + '/monitor');
                        const snapshot = await ref.once('value');
                        const val = snapshot.val();

                        if (val) {
                            if (val.tasks) tasks = val.tasks || [];
                            if (val.categories) categories = val.categories || [];

                            localStorage.setItem('planner_tasks', JSON.stringify(tasks));
                            localStorage.setItem('planner_categories', JSON.stringify(categories));

                            renderStack();
                            if (currentTab === 'cats') renderManageCats();
                        }
                    } catch (e) {
                        console.error("Sync error:", e);
                    }
                }

                // Reset after delay
                setTimeout(() => {
                    isRefreshing = false;
                    indicator.classList.remove('visible', 'refreshing');
                    pullText.textContent = 'Потяните для обновления';
                }, 1000);
            }
        }
    });
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    initTheme(); // Initialize theme
    initPullToRefresh(); // Initialize pull to refresh
    updateHeaderDate();
    setupEventListeners(); // Enable UI interaction

    initSync(); // Start Sync
    switchTab('home'); // Force correct view state
    renderStack();

    // Show onboarding for first-time users - DISABLED per user request
    // showOnboarding();

    console.log("App v64.0 loaded successfully");
});

// Firebase Config (loaded from separate file)
// @ts-ignore - firebaseConfig defined in firebase-config.js
let db = null;
let tgUserId = null;

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    console.log("Firebase initialized");
} catch (e) {
    console.error("Firebase init failed:", e);
}

function initSync() {
    // 1. Try to get Telegram User ID
    try {
        if (window.Telegram?.WebApp) {
            const tg = window.Telegram.WebApp;
            tg.ready();
            if (tg.initDataUnsafe?.user?.id) {
                tgUserId = tg.initDataUnsafe.user.id.toString();
                console.log("TG User ID found:", tgUserId);
            }
        }
    } catch (e) {
        console.warn("TG Init failed", e);
    }

    if (tgUserId && db) {
        // Presence Logic
        db.ref('.info/connected').on('value', (snap) => {
            if (window.updateOnlineStatus) {
                window.updateOnlineStatus(snap.val() === true);
            }
        });

        // Cloud Mode: Listen to changes
        const ref = db.ref('users/' + tgUserId + '/monitor');

        // Initial Check: If Cloud is empty, push Local
        ref.once('value').then(snapshot => {
            const val = snapshot.val();
            if (!val && tasks.length > 0) {
                console.log("Cloud empty, pushing local data...");
                save(); // Force push
            }
        });

        ref.on('value', (snapshot) => {
            const val = snapshot.val();
            if (val) {
                // Merge or Overwrite? For now Overwrite from cloud to be safe sync.
                if (val.tasks) tasks = val.tasks || [];
                if (val.categories) categories = val.categories || [];

                // Update Local Storage as backup
                localStorage.setItem('planner_tasks', JSON.stringify(tasks));
                localStorage.setItem('planner_categories', JSON.stringify(categories));

                renderStack();
                // Only update manage list if on that tab
                if (currentTab === 'cats') renderManageCats();
                console.log("Synced from Cloud");
            }
        });
    } else {
        // Offline Mode
        console.log("Offline Mode (No TG ID or Firebase)");
        if (window.updateOnlineStatus) window.updateOnlineStatus(false);
    }
}

// --- HELPER FUNCTIONS ---
function compressImage(file, maxWidth, quality, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round(height * (maxWidth / width));
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Compress
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            callback(dataUrl);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Global State for Selections
let selectedNotify = 0;
let selectedRepeat = 'none';

window.selectNotify = (mins, el) => {
    selectedNotify = mins;
    // Update UI
    const container = el.parentElement;
    container.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
};

window.selectRepeat = (type, el) => {
    selectedRepeat = type;
    const container = el.parentElement;
    container.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
};

window.toggleAdvanced = () => {
    const adv = document.getElementById('advanced-settings');
    const chev = document.getElementById('adv-chevron');
    if (adv && chev) {
        adv.classList.toggle('hidden');
        chev.style.transform = adv.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
    }
};

// --- WIZARD LOGIC ---
let wizardStep = 1;
const totalSteps = 4;

window.openAddTaskModal = () => {
    // Reset State
    wizardStep = 1;
    document.getElementById('input-title').value = '';
    document.getElementById('input-desc').value = '';
    currentPhotos = [];
    selectedDate = null;
    document.getElementById('label-date').innerText = 'Выбрать дату';
    document.getElementById('btn-clear-date').classList.add('hidden');
    document.getElementById('input-time').value = '';
    selectedCategory = 'ОБЩИЕ';
    const labelCat = document.getElementById('label-cat');
    if (labelCat) {
        labelCat.innerText = 'ОБЩИЕ';
        labelCat.classList.add('text-dark');
        labelCat.classList.remove('text-accent');
    }

    // Clear Photos UI
    const grid = document.getElementById('photos-preview-container');
    if (grid) grid.innerHTML = '';

    // Reset Chips
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));

    updateWizardUI();
    const m = document.getElementById('modal-add-task');
    if (m) m.classList.remove('hidden');
    setTimeout(() => document.getElementById('input-title').focus(), 100);
};

window.updateWizardUI = () => {
    // Hide all steps
    for (let i = 1; i <= totalSteps; i++) {
        const el = document.getElementById(`wizard-step-${i}`);
        if (el) el.classList.add('hidden');
    }

    // Show current
    const currentEl = document.getElementById(`wizard-step-${wizardStep}`);
    if (currentEl) currentEl.classList.remove('hidden');

    // Update Buttons
    const btnBack = document.getElementById('btn-wizard-back');
    const btnNext = document.getElementById('btn-wizard-next');

    if (btnBack) btnBack.innerText = (wizardStep === 1) ? 'Отмена' : 'Назад';
    if (btnNext) btnNext.innerText = (wizardStep === totalSteps) ? 'Готово' : 'Далее';
};

window.nextStep = () => {
    if (wizardStep === 1) {
        const title = document.getElementById('input-title').value.trim();
        if (!title) {
            alert("Введите название задачи");
            return;
        }
    }

    if (wizardStep < totalSteps) {
        wizardStep++;
        updateWizardUI();
    } else {
        // FINISH - Trigger Save
        document.getElementById('btn-save-task').click();
    }
};

window.prevStep = () => {
    if (wizardStep > 1) {
        wizardStep--;
        updateWizardUI();
    } else {
        // Close Modal
        const m = document.getElementById('modal-add-task');
        if (m) m.classList.add('hidden');
    }
};


function setupEventListeners() {
    try {
        // Bind Wizard Buttons
        const btnWizNext = document.getElementById('btn-wizard-next');
        if (btnWizNext) btnWizNext.onclick = window.nextStep;

        const btnWizBack = document.getElementById('btn-wizard-back');
        if (btnWizBack) btnWizBack.onclick = window.prevStep;

        // Close Add Modal
        const btnCloseAdd = document.getElementById('close-add-task');
        if (btnCloseAdd) {
            btnCloseAdd.onclick = () => {
                const m = document.getElementById('modal-add-task');
                if (m) m.classList.add('hidden');
            };
        }

        // Close Modal View
        const btnCloseView = document.getElementById('btn-close-view');
        if (btnCloseView) {
            btnCloseView.onclick = () => {
                const m = document.getElementById('modal-view-task');
                if (m) m.classList.add('hidden');
            };
        }

        // View -> Edit
        const btnEditTop = document.getElementById('btn-view-edit-top');
        if (btnEditTop) {
            btnEditTop.onclick = () => {
                const mView = document.getElementById('modal-view-task');
                if (mView) mView.classList.add('hidden');

                if (currentEditingTaskId) {
                    const task = tasks.find(t => t.id === currentEditingTaskId);
                    if (task) openEditModal(task);
                }
            };
        }

        // View -> Complete
        const btnViewComplete = document.getElementById('btn-view-complete');
        if (btnViewComplete) {
            btnViewComplete.onclick = () => {
                if (currentEditingTaskId) {
                    toggleTask(currentEditingTaskId);
                    const mView = document.getElementById('modal-view-task');
                    if (mView) mView.classList.add('hidden');
                }
            };
        }

        // View -> Delete
        const btnViewDelete = document.getElementById('btn-view-delete');
        if (btnViewDelete) {
            btnViewDelete.onclick = () => {
                if (currentEditingTaskId) {
                    // Find and store task before deletion
                    const taskToDelete = tasks.find(t => t.id === currentEditingTaskId);
                    if (!taskToDelete) return;

                    const taskIndex = tasks.findIndex(t => t.id === currentEditingTaskId);

                    // Delete task
                    tasks = tasks.filter(t => t.id !== currentEditingTaskId);
                    save();
                    currentEditingTaskId = null;
                    renderStack();
                    const mView = document.getElementById('modal-view-task');
                    if (mView) mView.classList.add('hidden');

                    hapticImpact('heavy');

                    // Show undo toast
                    showUndoToast('Задача удалена', () => {
                        // Undo: restore task
                        tasks.splice(taskIndex, 0, taskToDelete);
                        save();
                        renderStack();
                    });
                }
            };
        }

        // Save Task (Wizard calls this)
        const btnSaveTask = document.getElementById('btn-save-task');
        if (btnSaveTask) {
            btnSaveTask.onclick = () => {
                const titleInput = document.getElementById('input-title');
                const title = titleInput ? titleInput.value.trim() : '';

                if (!title) return; // Step 1 handled validation

                if (currentEditingTaskId) {
                    // Edit (Legacy Edit Logic Wrapper)
                    const taskIndex = tasks.findIndex(t => t.id === currentEditingTaskId);
                    if (taskIndex > -1) {
                        tasks[taskIndex] = {
                            ...tasks[taskIndex],
                            title: title,
                            description: document.getElementById('input-desc').value,
                            category: selectedCategory,
                            // tags: document.getElementById('input-tags').value,
                            time: document.getElementById('input-time').value,
                            date: selectedDate,
                            photos: currentPhotos
                        };
                    }
                } else {
                    // Create
                    const newTask = {
                        id: Date.now().toString(),
                        title: title,
                        description: document.getElementById('input-desc').value,
                        category: selectedCategory,
                        // tags: document.getElementById('input-tags').value,
                        time: document.getElementById('input-time').value,
                        date: selectedDate,
                        photos: currentPhotos,
                        completed: false
                    };
                    tasks.push(newTask);
                }

                save();
                renderStack();
                const mAdd = document.getElementById('modal-add-task');
                if (mAdd) mAdd.classList.add('hidden');
            };
        }

        // Photo Handlers (Wizard)
        const btnAddPhotoWiz = document.getElementById('btn-add-photo-wizard');
        const inputPhoto = document.getElementById('input-photo-native');

        if (btnAddPhotoWiz && inputPhoto) {
            btnAddPhotoWiz.onclick = () => inputPhoto.click();

            inputPhoto.onchange = async (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    if (currentPhotos.length + e.target.files.length > 5) {
                        alert("Максимум 5 фото");
                        return;
                    }

                    for (let i = 0; i < e.target.files.length; i++) {
                        const file = e.target.files[i];
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                            currentPhotos.push(evt.target.result);
                            renderPhotoPreviews();
                        };
                        reader.readAsDataURL(file);
                    }
                }
                inputPhoto.value = '';
            };
        }

        // Undo button handler
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) {
            undoBtn.onclick = performUndo;
        }

        // Close statistics modal
        const closeStats = document.getElementById('close-stats');
        if (closeStats) {
            closeStats.onclick = () => {
                document.getElementById('modal-statistics').classList.add('hidden');
            };
        }

        // Close onboarding modal
        const closeOnboardingBtn = document.getElementById('btn-close-onboarding');
        if (closeOnboardingBtn) {
            closeOnboardingBtn.onclick = window.closeOnboarding;
        }

        // Draft autosave listeners
        const titleInput = document.getElementById('input-title');
        const descInput = document.getElementById('input-desc');
        const timeInput = document.getElementById('input-time');
    } catch (e) {
        console.error("Setup Listeners Error:", e);
        alert("Setup Error: " + e.message);
    }
}

// Delete Task Button
const btnDelete = document.getElementById('btn-delete-task');
if (btnDelete) {
    btnDelete.onclick = () => {
        if (currentEditingTaskId) {
            // Find and store task before deletion
            const taskToDelete = tasks.find(t => t.id === currentEditingTaskId);
            if (!taskToDelete) return;

            const taskIndex = tasks.findIndex(t => t.id === currentEditingTaskId);

            // Delete task
            tasks = tasks.filter(t => t.id !== currentEditingTaskId);
            save();
            currentEditingTaskId = null;
            modalAdd.classList.add('hidden');
            renderStack();

            hapticImpact('heavy');

            // Show undo toast
            showUndoToast('Задача удалена', () => {
                // Undo: restore task
                tasks.splice(taskIndex, 0, taskToDelete);
                save();
                renderStack();
            });
        }
    };
}

// Modal Date Pickers
document.getElementById('btn-pick-date').onclick = () => {
    document.getElementById('modal-datepicker').classList.remove('hidden');
};
document.getElementById('btn-cancel-date').onclick = () => {
    document.getElementById('modal-datepicker').classList.add('hidden');
};
document.getElementById('btn-confirm-date').onclick = () => {
    const val = inputDateNative.value;
    if (val) selectedDate = val;
    updateDateLabel();
    document.getElementById('modal-datepicker').classList.add('hidden');
};
document.getElementById('btn-clear-date').onclick = (e) => {
    e.stopPropagation();
    selectedDate = null;
    updateDateLabel();
};

// Category Picker
const btnPickCat = document.getElementById('btn-pick-cat');
if (btnPickCat) {
    btnPickCat.onclick = () => {
        const dd = document.getElementById('dropdown-cat');
        dd.classList.toggle('hidden');
        dd.innerHTML = '';
        categories.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.innerText = cat;
            item.onclick = () => {
                selectedCategory = cat;
                document.getElementById('label-cat').innerText = cat;
                dd.classList.add('hidden');
            };
            dd.appendChild(item);
        });
    };
}

// Note: nav-home and nav-cats use inline onclick="switchTab(...)" in HTML
// Modal Manage Cats is also handled via view-cats tab now

// Search Toggle
const btnSearch = document.getElementById('btn-search-toggle');
if (btnSearch) {
    btnSearch.onclick = (e) => {
        e.stopPropagation(); // Prevent document click from closing immediately
        const sb = document.getElementById('search-bar-container');
        sb.classList.toggle('hidden');
        if (!sb.classList.contains('hidden')) {
            document.getElementById('global-search').focus();
        }
    };
}

// Close search on click outside
document.addEventListener('click', (e) => {
    const sb = document.getElementById('search-bar-container');
    const btn = document.getElementById('btn-search-toggle');
    if (sb && !sb.classList.contains('hidden')) {
        if (!sb.contains(e.target) && !btn.contains(e.target)) {
            sb.classList.add('hidden');
        }
    }
});

// Search functionality with debounce
let searchTimeout;
const searchInput = document.getElementById('global-search');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();

        // Clear previous timeout
        clearTimeout(searchTimeout);

        // Debounce search by 300ms
        searchTimeout = setTimeout(() => {
            filterTasks(query);
        }, 300);
    });
}

function filterTasks(query) {
    const allTasks = document.querySelectorAll('.task-item');

    allTasks.forEach(taskEl => {
        const title = taskEl.querySelector('.task-title');
        if (title) {
            const titleText = title.textContent.toLowerCase();
            if (titleText.includes(query)) {
                taskEl.style.display = 'flex';
            } else {
                taskEl.style.display = 'none';
            }
        }
    });
}

// ===== UNDO FUNCTIONALITY =====
function showUndoToast(message, undoCallback) {
    const toast = document.getElementById('undo-toast');
    const toastMessage = document.getElementById('toast-message');
    const undoBtn = document.getElementById('undo-btn');
    const countdownEl = document.getElementById('undo-countdown');

    // Clear previous timeout
    if (undoTimeout) {
        clearTimeout(undoTimeout);
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    // Set message and callback
    toastMessage.textContent = message;
    lastAction = undoCallback;

    // Show toast
    toast.classList.remove('hidden');

    // Countdown
    let secondsLeft = 5;
    countdownEl.textContent = secondsLeft;

    countdownInterval = setInterval(() => {
        secondsLeft--;
        countdownEl.textContent = secondsLeft;
        if (secondsLeft <= 0) {
            clearInterval(countdownInterval);
        }
    }, 1000);

    // Auto hide after delay
    undoTimeout = setTimeout(() => {
        hideUndoToast();
    }, UNDO_DELAY);
}

function hideUndoToast() {
    const toast = document.getElementById('undo-toast');
    toast.classList.add('hidden');

    if (undoTimeout) {
        clearTimeout(undoTimeout);
        undoTimeout = null;
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    lastAction = null;
}

function performUndo() {
    if (lastAction) {
        lastAction();
        hideUndoToast();
        hapticImpact('medium');
    }
}

// Haptic feedback (Telegram WebApp API)
function hapticImpact(style = 'medium') {
    try {
        if (window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.impactOccurred(style);
        }
    } catch (e) {
        // Ignore errors
    }
}


function renderManageCats() {
    const list = document.getElementById('cats-list-container');
    if (!list) return;
    list.innerHTML = '';

    // Add instruction text
    // const hint = document.createElement('div');
    // hint.innerText = "Удерживайте и тяните для сортировки";
    // ... removed for clean UI


    categories.forEach((cat, idx) => {
        const row = document.createElement('div');
        row.className = 'cat-item-row';

        // Enable Drag
        row.draggable = true;
        row.dataset.index = idx;

        // Visual layout: [Trash] [Edit] [Name] ... [Handle]
        row.innerHTML = `
            <div class="cat-item-left">
                <button class="cat-action-btn" onclick="deleteCat('${cat}')">
                    <i class="fas fa-trash-alt"></i>
                </button>
                <button class="cat-action-btn" onclick="renameCatPrompt('${cat}')">
                    <i class="fas fa-pen"></i>
                </button>
                <div class="cat-name">${cat}</div>
            </div>
            <div class="cat-drag-handle">
                <i class="fas fa-bars"></i>
            </div>
        `;

        // Desktop Drag Events
        row.addEventListener('dragstart', handleDragStart);
        row.addEventListener('dragover', handleDragOver);
        row.addEventListener('drop', handleDrop);
        row.addEventListener('dragend', handleDragEnd);

        // Mobile Touch Events
        row.addEventListener('touchstart', handleTouchStart, { passive: false });
        row.addEventListener('touchmove', handleTouchMove, { passive: false });
        row.addEventListener('touchend', handleTouchEnd);

        list.appendChild(row);
    });
}


// --- DRAG & DROP LOGIC ---
let dragSrcEl = null;

function handleDragStart(e) {
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.classList.add('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    if (dragSrcEl !== this) {
        const srcIdx = parseInt(dragSrcEl.dataset.index);
        const targetIdx = parseInt(this.dataset.index);
        moveCatItem(srcIdx, targetIdx);
    }
    return false;
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
}

// Touch Logic
let touchSrcIdx = null;

// --- Tabs & Navigation ---
// currentTab is declared at top of file

function switchTab(tab) {
    currentTab = tab;

    // Update Dock
    document.querySelectorAll('.dock-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(tab === 'home' ? 'nav-home' : 'nav-cats');
    if (activeBtn) activeBtn.classList.add('active');

    // Update Views
    const homeView = document.getElementById('category-stack');
    const catsView = document.getElementById('view-cats');
    const searchBar = document.getElementById('search-bar-container'); // Hide search in cats?

    if (tab === 'home') {
        if (homeView) homeView.classList.remove('hidden');
        if (catsView) catsView.classList.add('hidden');
        renderStack();
    } else {
        if (homeView) homeView.classList.add('hidden');
        if (catsView) catsView.classList.remove('hidden');
        renderManageCats(); // Re-render list
    }
}

// --- Drag & Drop (Mobile Visuals) ---
let touchStartY = 0;
let dragElInitialTop = 0;

function handleTouchStart(e) {
    touchSrcIdx = parseInt(this.dataset.index);
    this.classList.add('dragging');

    const touch = e.touches[0];
    touchStartY = touch.clientY;

    // Allow visual movement
    this.style.transition = 'none'; // Disable transition for direct 1:1 movement
}

function handleTouchMove(e) {
    e.preventDefault(); // Stop scroll
    if (touchSrcIdx === null) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - touchStartY;

    // Move dragged element
    this.style.transform = `translateY(${deltaY}px) scale(1.05)`;
    this.style.background = '#FFFFFF';
    this.style.zIndex = '1000';
    this.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';

    const allRows = Array.from(document.querySelectorAll('.cat-item-row'));
    const draggedRow = this;
    const draggedRect = draggedRow.getBoundingClientRect();
    const draggedCenterY = draggedRect.top + draggedRect.height / 2;

    // Calculate potential new index
    // We check where the dragged item fits among the STATIC positions of other items
    let potentialIndex = 0;

    // We assume rows are ordered in DOM.
    // We want to find the first row whose center is "below" the dragged item's center
    // BUT we must exclude the dragged row itself from this logic to simulate the "gap"
    const staticRows = allRows.filter(r => r !== draggedRow);

    if (staticRows.length === 0) {
        potentialIndex = 0;
    } else {
        // If above the first one
        const firstRect = staticRows[0].getBoundingClientRect();
        if (draggedCenterY < firstRect.top) {
            potentialIndex = 0;
        }
        // If below the last one
        else if (draggedCenterY > staticRows[staticRows.length - 1].getBoundingClientRect().bottom) {
            potentialIndex = allRows.length - 1;
        }
        // Somewhere in between
        else {
            // Find insertion point
            let inserted = false;
            for (let i = 0; i < staticRows.length; i++) {
                const rect = staticRows[i].getBoundingClientRect();
                const center = rect.top + rect.height / 2;
                if (draggedCenterY < center) {
                    // Insert before this static item. 
                    // The static item is at index i in the filtered list.
                    // The original index of this static item might be > touchSrcIdx.
                    // Basically, potentialIndex is the position in the FULL list.

                    // Helper: map back to original indices
                    const originalIdx = parseInt(staticRows[i].dataset.index);

                    // If we move item up (potential < src):
                    // The item currently at potentialIndex shifts down.
                    // If we move item down (potential > src):
                    // The item currently at potentialIndex shifts up.

                    // Let's rely on simple swapping logic relative to original list
                    if (originalIdx < touchSrcIdx) {
                        potentialIndex = originalIdx;
                    } else {
                        potentialIndex = originalIdx - 1;
                        // Wait, if we are moving down, we skip passed items.
                        // It's easier to count how many items we passed.
                    }
                    inserted = true;
                    break;
                }
            }
            if (!inserted) potentialIndex = allRows.length - 1;
        }
    }

    // Correct logic: Just iterate list and count how many items are "above" the cursor
    let newIndex = 0;
    staticRows.forEach(row => {
        const rect = row.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        if (draggedCenterY > center) {
            newIndex++;
        }
    });

    // Apply visual transforms to Make Room
    // Items between source and newIndex need to shift
    const rowHeight = draggedRect.height + 12; // 12px margin

    allRows.forEach(row => {
        if (row === draggedRow) return;

        const rowIdx = parseInt(row.dataset.index);
        row.style.transition = 'transform 0.2s ease';

        // If dragging DOWN (newIndex > source)
        if (newIndex > touchSrcIdx) {
            /* 
               Items [source+1 ... newIndex] should shift UP 
               Example: [A, B, C, D]. Move A (0) to pos 2 (after B). New Order: [B, A, C, D]
               B (1) shifts UP.
            */
            if (rowIdx > touchSrcIdx && rowIdx <= newIndex) {
                row.style.transform = `translateY(-${rowHeight}px)`;
            } else {
                row.style.transform = '';
            }
        }
        // If dragging UP (newIndex < source)
        else if (newIndex < touchSrcIdx) {
            /*
               Items [newIndex ... source-1] should shift DOWN
               Example: [A, B, C, D]. Move C (2) to pos 0 (before A). New Order: [C, A, B, D]
               A (0), B (1) shift DOWN.
            */
            if (rowIdx >= newIndex && rowIdx < touchSrcIdx) {
                row.style.transform = `translateY(${rowHeight}px)`;
            } else {
                row.style.transform = '';
            }
        } else {
            row.style.transform = '';
        }
    });

    // Store potential target for Drop
    this.dataset.targetIndex = newIndex;
}

function handleTouchEnd(e) {
    this.classList.remove('dragging');
    this.style.transform = ''; // Reset
    this.style.transition = ''; // Restore
    this.style.background = '';
    this.style.zIndex = '';
    this.style.boxShadow = '';

    // Remove all transitions from others
    document.querySelectorAll('.cat-item-row').forEach(row => {
        row.style.transform = '';
        row.style.transition = '';
    });

    // Use the target index we calculated during the move
    // Default to src index if undefined
    let targetIdx = parseInt(this.dataset.targetIndex);

    if (isNaN(targetIdx)) {
        targetIdx = touchSrcIdx;
    }

    // Only move if changed
    if (targetIdx !== touchSrcIdx) {
        moveCatItem(touchSrcIdx, targetIdx);
    } else {
        renderManageCats(); // Re-render to clear any stuck styles
    }
    touchSrcIdx = null;
}


function moveCatItem(fromIndex, toIndex) {
    const item = categories[fromIndex];
    categories.splice(fromIndex, 1);
    categories.splice(toIndex, 0, item);
    save();
    renderManageCats();
    renderStack();
}

// Old moveCat removed in favor of moveCatItem
// window.moveCat = ...

function updateHeaderDate() {
    const headerDate = document.getElementById('header-date');
    if (headerDate) {
        const now = new Date();
        const options = { day: 'numeric', month: 'long' };
        const dateString = now.toLocaleDateString('ru-RU', options);
        headerDate.textContent = dateString;
    }
}

function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

function save() {
    // Local Save (Always backup)
    localStorage.setItem('planner_tasks', JSON.stringify(tasks));
    localStorage.setItem('planner_categories', JSON.stringify(categories));

    // Cloud Save
    if (tgUserId && db) {
        db.ref('users/' + tgUserId + '/monitor').set({
            tasks: tasks,
            categories: categories,
            last_updated: Date.now()
        }).catch(err => console.error("Cloud Save Error:", err));
    }

    renderStack();
}

function renderStack() {
    try {
        if (!stackContainer) return;
        stackContainer.innerHTML = '';

        // Repair expandedCategory
        if (!expandedCategory || !categories.includes(expandedCategory)) {
            expandedCategory = categories[0] || (categories.length > 0 ? categories[0] : null);
        }

        if (!expandedCategory) return; // No categories at all?

        const expIndex = categories.indexOf(expandedCategory);
        const total = categories.length;

        categories.forEach((cat, index) => {
            if (!cat) return;
            const card = document.createElement('div');
            card.className = 'category-card';

            const isAfterExpanded = index > expIndex;
            const isExpanded = (expandedCategory === cat);

            if (!isAfterExpanded) {
                // Stack at TOP
                const topPos = TOP_OFFSET_PX + (index * HEADER_HEIGHT_PX);
                card.style.top = `${topPos}px`;
            } else {
                // Stack at BOTTOM
                const cardsBelow = total - index;
                // Boost overlap safe zone - increased to 220px (User Request for strict limit)
                const bottomOffset = 220 + (cardsBelow * HEADER_HEIGHT_PX);
                card.style.top = `calc(100dvh - ${bottomOffset}px)`;
            }

            card.style.zIndex = 10 + index; // Lower base index

            if (isExpanded) {
                card.classList.add('expanded');
            } else {
                card.classList.remove('expanded');
            }

            const catTasks = tasks.filter(t => t.category === cat);
            const count = catTasks.filter(t => !t.completed).length;

            // Only show list if expanded
            const listDisplay = isExpanded ? 'block' : 'none';

            card.innerHTML = `
                <div class="card-header">
                    <h2>${cat}</h2>
                    <div class="counter-badge">${count > 0 ? count : ''}</div>
                </div>
                <div class="task-list" id="list-${cat}" style="display: ${listDisplay};"></div>
            `;

            card.querySelector('.card-header').addEventListener('click', () => {
                toggleCard(cat);
            });

            stackContainer.appendChild(card);

            if (isExpanded) {
                const listEl = card.querySelector(`#list-${cat}`);
                renderTasksForCategory(listEl, catTasks);
            }
        });
    } catch (e) {
        console.error(e);
        alert("Render Error: " + e.message);
    }
}

function renderTasksForCategory(container, taskList) {
    const today = getTodayStr();

    taskList.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return 0;
    });

    taskList.forEach(task => {
        const isCompleted = task.completed;
        const isOverdue = !isCompleted && task.date && task.date < today;
        const isToday = !isCompleted && task.date && task.date === today;
        const isCritical = isOverdue || isToday;

        let infoText = '';
        if (task.time && isToday) infoText = task.time;
        else if (task.date && !isToday && !isOverdue) {
            const d = new Date(task.date);
            infoText = `до ${d.getDate()}.${d.getMonth() + 1}`;
        }
        else if (task.time) infoText = task.time;

        // Task item - no wrapper, no swipe actions
        const div = document.createElement('div');
        div.className = `task-item ${isCompleted ? 'completed' : ''} ${isCritical ? 'critical' : ''}`;
        div.dataset.taskId = task.id;

        div.innerHTML = `
            <div class="task-checkbox-area">
                <div class="checkbox-circle"></div>
            </div>
            <div class="task-content">
                <div class="task-title">${task.title}</div>
                <div class="meta-row">
                    ${isCritical && isOverdue ? '<div class="critical-label">ПРОСРОЧЕНО</div>' : ''}
                    ${isCritical && isToday ? '<div class="critical-label">СЕГОДНЯ</div>' : ''}
                    ${task.photos && task.photos.length > 0 ? '<div class="critical-label" style="color:var(--text-gray);"><i class="fas fa-paperclip"></i> ' + task.photos.length + '</div>' : ''}
                </div>
            </div>
            ${infoText ? `<div class="info-pill">${infoText}</div>` : ''}
        `;

        const checkboxArea = div.querySelector('.task-checkbox-area');
        checkboxArea.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTask(task.id);
        });

        const contentArea = div.querySelector('.task-content');
        contentArea.addEventListener('click', (e) => {
            e.stopPropagation();
            openTaskDetails(task);
        });

        container.appendChild(div);
    });
}

// Logic Actions
function toggleTask(id) {
    const t = tasks.find(x => x.id === id);
    if (t) {
        const wasCompleted = t.completed;
        const taskCopy = { ...t };

        t.completed = !t.completed;
        save();

        hapticImpact('light');

        // Show undo toast
        if (t.completed) {
            showUndoToast('Задача выполнена', () => {
                // Undo: revert completion
                const taskToUndo = tasks.find(x => x.id === id);
                if (taskToUndo) {
                    taskToUndo.completed = wasCompleted;
                    save();
                    renderStack();
                }
            });
        }
    }
}

function toggleCard(cat) {
    if (expandedCategory !== cat) {
        expandedCategory = cat;
        renderStack();
    }
}

// Global Exports
let currentEditingTaskId = null;
window.toggleCard = toggleCard;
window.toggleTask = toggleTask;
window.validateAndRepairData = validateAndRepairData;

// Logic Actions needed for openTaskDetails to be available?
// It was defined inside the scope in previous versions, let's make it global or hoist properly.
// The above structure has openTaskDetails missing? 
// No, I missed copying it in the manual rewrite above.
// Wait, I need to include openTaskDetails + updateDateLabel + formattingUtils.

function updateDateLabel() {
    const btnClear = document.getElementById('btn-clear-date');
    if (selectedDate) {
        labelDate.innerText = formatDate(selectedDate);
        labelDate.classList.add('text-accent');
        btnClear.classList.remove('hidden');
    } else {
        labelDate.innerText = "Без дедлайна";
        labelDate.classList.remove('text-accent');
        btnClear.classList.add('hidden');
    }
}

function formatDate(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function openTaskDetails(task) {
    try {
        console.log("Opening details for:", task.id);
        currentEditingTaskId = task.id;

        // Populate VIEW Modal
        document.getElementById('view-title').innerText = task.title;
        document.getElementById('view-category-badge').innerText = task.category || 'ОБЩИЕ';

        // Time
        const timeEl = document.getElementById('view-time-container');
        if (task.time) {
            timeEl.classList.remove('hidden');
            document.getElementById('view-time-val').innerText = task.time;
        } else {
            timeEl.classList.add('hidden');
        }

        // Date
        const dateEl = document.getElementById('view-date-container');
        if (task.date) {
            dateEl.classList.remove('hidden');
            const d = new Date(task.date);
            document.getElementById('view-date-val').innerText = d.toLocaleDateString('ru-RU');
        } else {
            dateEl.classList.add('hidden');
        }

        // Desc
        const descBlock = document.getElementById('view-desc-block');
        if (task.description) {
            descBlock.classList.remove('hidden');
            document.getElementById('view-desc-text').innerText = task.description;
        } else {
            descBlock.classList.add('hidden');
        }

        // Tags
        const tagsBlock = document.getElementById('view-tags-block');
        if (task.tags) {
            tagsBlock.classList.remove('hidden');
            document.getElementById('view-tags-text').innerText = task.tags;
        } else {
            tagsBlock.classList.add('hidden');
        }

        // Gallery
        const galleryBlock = document.getElementById('view-gallery-block');
        const track = document.getElementById('view-gallery-track');
        const dots = document.getElementById('view-gallery-dots');
        track.innerHTML = '';
        dots.innerHTML = '';

        if (task.photos && task.photos.length > 0) {
            galleryBlock.classList.remove('hidden');
            task.photos.forEach((src, idx) => {
                // Slide
                const slide = document.createElement('div');
                slide.className = 'gallery-item';
                slide.style.backgroundImage = `url('${src}')`;
                track.appendChild(slide);

                // Dot
                if (task.photos.length > 1) {
                    const dot = document.createElement('div');
                    dot.className = `dot ${idx === 0 ? 'active' : ''}`;
                    dots.appendChild(dot);
                }
            });

            // Scroll Listener for dots
            track.onscroll = () => {
                const width = track.offsetWidth;
                const idx = Math.round(track.scrollLeft / width);
                Array.from(dots.children).forEach((d, i) => {
                    d.className = `dot ${i === idx ? 'active' : ''}`;
                });
            };

        } else {
            galleryBlock.classList.add('hidden');
        }

        // Check complete status to style button differently?
        // For now simple Toggle logic
        const btnComplete = document.getElementById('btn-view-complete');
        btnComplete.innerText = task.completed ? "ВЕРНУТЬ" : "ВЫПОЛНИТЬ";
        btnComplete.style.background = task.completed ? "#8E8E93" : "#FF3B30";

        document.getElementById('modal-view-task').classList.remove('hidden');
    } catch (e) {
        console.error(e);
        alert('Ошибка: ' + e.message);
    }
}

function openEditModal(task) {
    currentEditingTaskId = task.id;
    const modalTitle = document.getElementById('modal-title');
    const btnSave = document.getElementById('btn-save-task');
    const btnDelete = document.getElementById('btn-delete-task'); // Hide logic in edit

    modalTitle.innerText = "РЕДАКТИРОВАНИЕ";

    document.getElementById('input-title').value = task.title;
    document.getElementById('input-desc').value = task.description || '';
    document.getElementById('input-tags').value = task.tags || '';
    document.getElementById('input-time').value = task.time || '';

    selectedCategory = task.category;
    document.getElementById('label-cat').innerText = selectedCategory;
    selectedDate = task.date;

    // Load photos
    currentPhotos = task.photos ? [...task.photos] : [];
    renderPhotoPreviews();

    updateDateLabel();

    btnSave.innerText = "СОХРАНИТЬ";
    btnSave.style.background = "var(--text-dark)";
    if (btnDelete) btnDelete.classList.add('hidden'); // Delete is in View menu now

    modalAdd.classList.remove('hidden');
}

function renderPhotoPreviews() {
    const container = document.getElementById('photos-preview-container');
    if (!container) return;
    container.innerHTML = '';

    currentPhotos.forEach((src, idx) => {
        const thumb = document.createElement('div');
        thumb.style.cssText = `
            width: 60px; height: 60px; flex-shrink:0; 
            border-radius: 8px; background-image: url('${src}'); 
            background-size: cover; background-position: center;
            position: relative;
        `;

        const btnDel = document.createElement('button');
        btnDel.innerHTML = '<i class="fas fa-times"></i>';
        btnDel.style.cssText = `
            position: absolute; top: -5px; right: -5px;
            width: 20px; height: 20px; border-radius: 50%;
            background: red; color: white; border: none;
            font-size: 10px; display: flex; align-items: center; justify-content: center;
            cursor: pointer;
        `;
        btnDel.onclick = (e) => {
            e.stopPropagation(); // prevent modal close logic if any
            currentPhotos.splice(idx, 1);
            renderPhotoPreviews();
        };

        thumb.appendChild(btnDel);
        container.appendChild(thumb);
    });
}

window.openTaskDetails = openTaskDetails;
window.openEditModal = openEditModal;

// --- Category Management Functions ---

function addNewCatPrompt() {
    // Simple prompt for now, can be upgraded to modal if needed
    const name = prompt("Введите название новой категории:");
    if (name && name.trim()) {
        const cleanName = name.trim();
        if (!categories.includes(cleanName)) {
            categories.push(cleanName);
            save(); // Use wrapper save()
            renderStack(); // Update Home
            renderManageCats(); // Update Manage Tab
        } else {
            alert("Такая категория уже существует!");
        }
    }
}

function renameCatPrompt(oldName) {
    const newName = prompt("Новое название:", oldName);
    if (newName && newName.trim() && newName !== oldName) {
        const cleanName = newName.trim();
        if (categories.includes(cleanName)) {
            alert("Такая категория уже существует!");
            return;
        }

        // Update Category List
        const idx = categories.indexOf(oldName);
        if (idx !== -1) {
            categories[idx] = cleanName;
        }

        // Update Tasks
        tasks.forEach(t => {
            if (t.category === oldName) {
                t.category = cleanName;
            }
        });

        // Update Expanded State
        if (expandedCategory === oldName) {
            expandedCategory = cleanName;
        }

        save();
        renderStack();
        renderManageCats();
    }
}

function deleteCat(cat) {
    if (confirm(`Удалить категорию "${cat}" и все задачи в ней?`)) {
        categories = categories.filter(c => c !== cat);
        tasks = tasks.filter(t => t.category !== cat); // Cascade delete

        if (expandedCategory === cat) {
            expandedCategory = null;
        }

        save();
        renderStack();
        renderManageCats();
    }
}

function updateOnlineStatus(isOnline) {
    const dot = document.getElementById('header-status-dot');
    if (!dot) return;

    if (isOnline) {
        dot.classList.remove('syncing');
        dot.classList.add('online');
    } else {
        dot.classList.remove('online');
        dot.classList.remove('syncing');
    }
}

// Ensure exports - ALL functions used in HTML onclick need to be global
window.openAddTaskModal = openAddTaskModal;
window.updateOnlineStatus = updateOnlineStatus;
window.switchTab = switchTab;
window.addNewCatPrompt = addNewCatPrompt;
window.renameCatPrompt = renameCatPrompt;
window.deleteCat = deleteCat;
window.toggleTask = toggleTask;
window.toggleCard = toggleCard;
window.openTaskDetails = openTaskDetails;

// ===== STATISTICS =====
function showStatistics() {
    const today = getTodayStr();

    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const todayTasks = tasks.filter(t => !t.completed && t.date === today).length;
    const overdue = tasks.filter(t => !t.completed && t.date && t.date < today).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Update modal
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-completed').textContent = completed;
    document.getElementById('stat-today').textContent = todayTasks;
    document.getElementById('stat-overdue').textContent = overdue;
    document.getElementById('stat-progress').style.width = percent + '%';
    document.getElementById('stat-percent').textContent = percent + '%';

    // Show modal
    document.getElementById('modal-statistics').classList.remove('hidden');
}

// Export statistics function
window.showStatistics = showStatistics;

// ===== TEMPLATES =====
function applyTemplate(templateText) {
    const titleInput = document.getElementById('input-title');
    if (titleInput) {
        titleInput.value = templateText;
        hapticImpact('light');
    }
}

window.applyTemplate = applyTemplate;

// ===== EMOJI PICKER =====
function addEmoji(emoji) {
    const input = document.getElementById('input-new-cat');
    if (input) {
        input.value += emoji;
        input.focus();
        hapticImpact('light');
    }
}

window.addEmoji = addEmoji;

// ===== ONBOARDING =====
function showOnboarding() {
    const hasSeenOnboarding = localStorage.getItem('onboarding_seen');
    console.log('[Onboarding] hasSeenOnboarding:', hasSeenOnboarding);
    if (!hasSeenOnboarding) {
        setTimeout(() => {
            document.getElementById('modal-onboarding').classList.remove('hidden');
            console.log('[Onboarding] Modal shown');
        }, 500);
    }
}

function closeOnboarding() {
    console.log('[Onboarding] closeOnboarding called');
    const modal = document.getElementById('modal-onboarding');
    if (modal) {
        modal.classList.add('hidden');
        localStorage.setItem('onboarding_seen', 'true');
        console.log('[Onboarding] Modal hidden, flag set');
    } else {
        console.error('[Onboarding] Modal element not found!');
    }
}

// Debug function to reset onboarding
function resetOnboarding() {
    localStorage.removeItem('onboarding_seen');
    console.log('[Onboarding] Reset! Reload page to see onboarding.');
    showOnboarding();
}

window.closeOnboarding = closeOnboarding;
window.resetOnboarding = resetOnboarding;