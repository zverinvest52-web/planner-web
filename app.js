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
const TOP_OFFSET_PX = 10;

// Init
document.addEventListener('DOMContentLoaded', () => {
    updateHeaderDate();
    setupEventListeners(); // Enable UI interaction
    initSync(); // Start Sync
    switchTab('home'); // Force correct view state
    renderStack();
    console.log("App v43.0 loaded successfully");
});

// Firebase Init
const firebaseConfig = {
    apiKey: "AIzaSyDm1OtrN4y6xzxiSwxEe6fWBQbxPF-_2W4",
    authDomain: "planer-a8373.firebaseapp.com",
    databaseURL: "https://planer-a8373-default-rtdb.firebaseio.com",
    projectId: "planer-a8373",
    storageBucket: "planer-a8373.firebasestorage.app",
    messagingSenderId: "605434976950",
    appId: "1:605434976950:web:aaa57c2c90a36d495c6417",
    measurementId: "G-2578HLN9LR"
};
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

function setupEventListeners() {
    // Note: Add Task button uses inline onclick="openAddTaskModal()" in HTML
    // No separate event binding needed here for the FAB button

    // Close Modal
    document.getElementById('close-add-task').onclick = () => {
        modalAdd.classList.add('hidden');
    };

    // Save Task
    document.getElementById('btn-save-task').onclick = () => {
        const title = document.getElementById('input-title').value.trim();
        if (!title) return;

        if (currentEditingTaskId) {
            // Edit
            const taskIndex = tasks.findIndex(t => t.id === currentEditingTaskId);
            if (taskIndex > -1) {
                tasks[taskIndex] = {
                    ...tasks[taskIndex],
                    title: title,
                    description: document.getElementById('input-desc').value,
                    category: selectedCategory,
                    tags: document.getElementById('input-tags').value,
                    time: document.getElementById('input-time').value,
                    date: selectedDate,
                    photos: currentPhotos // Save photos
                };
            }
        } else {
            // Create
            const newTask = {
                id: Date.now().toString(),
                title: title,
                description: document.getElementById('input-desc').value,
                category: selectedCategory,
                tags: document.getElementById('input-tags').value,
                time: document.getElementById('input-time').value,
                date: selectedDate,
                photos: currentPhotos, // Save photos
                completed: false
            };
            tasks.push(newTask);
        }

        save();
        modalAdd.classList.add('hidden');
    };

    // Photo Handlers
    const btnAddPhoto = document.getElementById('btn-add-photo');
    const inputPhoto = document.getElementById('input-photo-native');

    if (btnAddPhoto && inputPhoto) {
        btnAddPhoto.onclick = () => inputPhoto.click();

        inputPhoto.onchange = (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;

            // Limit total photos to prevent storage overflow (max 3 for now)
            if (currentPhotos.length + files.length > 5) {
                alert("Максимум 5 фото");
                return;
            }

            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    // Simple compression by not touching it? LocalStorage has 5MB limit. 
                    // ideally we should resize. For now raw base64.
                    currentPhotos.push(evt.target.result);
                    renderPhotoPreviews();
                };
                reader.readAsDataURL(file);
            });
            inputPhoto.value = ''; // Reset
        };
    }

    // Delete Task Button
    const btnDelete = document.getElementById('btn-delete-task');
    if (btnDelete) {
        btnDelete.onclick = () => {
            if (currentEditingTaskId) {
                tasks = tasks.filter(t => t.id !== currentEditingTaskId);
                save();
                modalAdd.classList.add('hidden');
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

// Helper for rename logic
window.renameCatPrompt = (oldName) => {
    const newName = prompt("Переименовать категорию:", oldName);
    if (newName && newName !== oldName && !categories.includes(newName)) {
        const idx = categories.indexOf(oldName);
        if (idx > -1) {
            categories[idx] = newName;
            // Update tasks
            tasks.forEach(t => { if (t.category === oldName) t.category = newName; });
            save();
            renderManageCats();
            renderStack();
        }
    }
};

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

    this.style.transform = `translateY(${deltaY}px) scale(1.03)`;

    // Show preview: highlight where item will land
    const allRows = document.querySelectorAll('.cat-item-row');
    const hoverTarget = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetRow = hoverTarget ? hoverTarget.closest('.cat-item-row') : null;

    allRows.forEach(row => {
        row.classList.remove('drag-over', 'drag-above');
        if (targetRow && row === targetRow && row !== this) {
            const targetIdx = parseInt(targetRow.dataset.index);
            if (targetIdx > touchSrcIdx) {
                row.classList.add('drag-over');
            } else {
                row.classList.add('drag-above');
            }
        }
    });
}

function handleTouchEnd(e) {
    this.classList.remove('dragging');
    this.style.transform = ''; // Reset
    this.style.transition = ''; // Restore

    // Remove all drag indicators
    document.querySelectorAll('.cat-item-row').forEach(row => {
        row.classList.remove('drag-over', 'drag-above');
    });

    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);

    // Find target row
    const targetRow = target ? target.closest('.cat-item-row') : null;

    if (targetRow) {
        const targetIdx = parseInt(targetRow.dataset.index);
        if (!isNaN(targetIdx) && targetIdx !== touchSrcIdx) {
            moveCatItem(touchSrcIdx, targetIdx);
        }
    } else {
        // Just reset if dropped nowhere valid
        renderManageCats();
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

window.deleteCat = (cat) => {
    if (confirm('Удалить папку "' + cat + '" и ВСЕ задачи в ней? Это действие нельзя отменить.')) {
        categories = categories.filter(c => c !== cat);
        // Delete tasks permanently
        tasks = tasks.filter(t => t.category !== cat);

        save();
        renderManageCats();
        renderStack();
    }
};

function updateHeaderDate() {
    const options = { month: 'long', day: 'numeric' };
    const dateStr = new Date().toLocaleDateString('ru-RU', options);
    document.getElementById('header-date').innerText = dateStr;
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

        const div = document.createElement('div');
        div.className = `task-item ${isCompleted ? 'completed' : ''} ${isCritical ? 'critical' : ''}`;

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
        t.completed = !t.completed;
        save();
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
    currentEditingTaskId = task.id;
    const modalTitle = document.getElementById('modal-title');
    const btnSave = document.getElementById('btn-save-task');
    const btnDelete = document.getElementById('btn-delete-task');

    const modalBody = document.querySelector('#modal-add-task .modal-body');

    // Make it look like "View Mode" if existing task
    modalTitle.innerText = task.title; // Show title in header? No, header is fixed usually.
    // Actually per screenshot: Header says "НОВАЯ ЗАДАЧА" for new.
    // For view: just show the task name centered?
    // Let's stick to standard edit fields but cleaner.

    modalTitle.innerText = "";
    document.getElementById('input-title').value = task.title;
    document.getElementById('input-desc').value = task.description || '';

    // Switch Save Button to "ВЫПОЛНИТЬ" (Red)
    btnSave.innerText = "ВЫПОЛНИТЬ";
    btnSave.style.background = "#FF3B30"; // Red
    btnSave.onclick = () => {
        // Logic to complete? Or just save?
        // For now save as is
        // Or maybe toggle complete?
        // Let's keep save logic for now but style it red.
        toggleTask(task.id);
        document.getElementById('modal-add-task').classList.add('hidden');
    };

    if (btnDelete) btnDelete.classList.remove('hidden');

    document.getElementById('input-title').value = task.title;
    document.getElementById('input-desc').value = task.description || '';
    document.getElementById('input-tags').value = (task.tags || []).toString();
    document.getElementById('input-time').value = task.time || '';

    selectedCategory = task.category;
    document.getElementById('label-cat').innerText = selectedCategory;
    selectedDate = task.date;

    // Load photos
    currentPhotos = task.photos || [];
    renderPhotoPreviews();

    updateDateLabel();

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

// Global Exports for HTML access
window.addNewCatPrompt = addNewCatPrompt;
window.renameCatPrompt = renameCatPrompt;
window.deleteCat = deleteCat;
// --- Restored Critical Functions ---

function openAddTaskModal() {
    // Reset fields
    currentEditingTaskId = null;
    const title = document.getElementById('modal-title');
    if (title) title.innerText = "НОВАЯ ЗАДАЧА";

    document.getElementById('input-title').value = "";
    document.getElementById('input-desc').value = "";
    document.getElementById('input-tags').value = "";
    document.getElementById('input-time').value = "";

    // Reset Date
    selectedDate = null;
    if (typeof updateDateLabel === 'function') updateDateLabel();

    // Reset Category
    selectedCategory = (categories && categories.length > 0) ? categories[0] : "ОБЩИЕ";
    if (categories.length === 0) categories.push("ОБЩИЕ");
    const lblCat = document.getElementById('label-cat');
    if (lblCat) lblCat.innerText = selectedCategory;

    // Reset Photos
    currentPhotos = [];
    if (typeof renderPhotoPreviews === 'function') renderPhotoPreviews();

    // Reset Buttons
    const btnSave = document.getElementById('btn-save-task');
    const btnDelete = document.getElementById('btn-delete-task');

    if (btnSave) {
        btnSave.innerText = "СОХРАНИТЬ";
        btnSave.style.background = "#007AFF"; // Blue
        // Note: btnSave.onclick is handled in init, but we might need to re-bind if init failed?
        // Actually init binding is static.
    }

    if (btnDelete) btnDelete.classList.add('hidden');

    const modal = document.getElementById('modal-add-task');
    if (modal) modal.classList.remove('hidden');
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
