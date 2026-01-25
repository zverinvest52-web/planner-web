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
const HEADER_HEIGHT_PX = 60;
const HEADER_HEIGHT_REM = 4;
const TOP_OFFSET_PX = 10;

// Init
document.addEventListener('DOMContentLoaded', () => {
    updateHeaderDate();
    renderStack();
    setupEventListeners();
    console.log("App v5.2 loaded successfully");
});

function setupEventListeners() {
    // Add Button
    document.getElementById('nav-add').onclick = () => {
        currentEditingTaskId = null;
        document.getElementById('modal-title').innerText = "НОВАЯ ЗАДАЧА";
        document.getElementById('btn-save-task').innerText = "СОЗДАТЬ";
        const btnDelete = document.getElementById('btn-delete-task');
        if (btnDelete) btnDelete.classList.add('hidden');

        document.getElementById('input-title').value = '';
        document.getElementById('input-desc').value = '';
        document.getElementById('input-tags').value = '';
        document.getElementById('input-time').value = '';
        selectedDate = null;
        updateDateLabel();
        selectedCategory = expandedCategory || categories[0];
        document.getElementById('label-cat').innerText = selectedCategory;

        modalAdd.classList.remove('hidden');
    };

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
                    date: selectedDate
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
                completed: false
            };
            tasks.push(newTask);
        }

        save();
        modalAdd.classList.add('hidden');
    };

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

    // Dock: Home
    const navHome = document.getElementById('nav-home');
    if (navHome) {
        navHome.onclick = () => {
            expandedCategory = null; // Collapse all
            renderStack();
        };
    }

    // Dock: Categories (Manage)
    const navCats = document.getElementById('nav-cats');
    const modalCats = document.getElementById('modal-manage-cats');

    if (navCats && modalCats) {
        navCats.onclick = () => {
            renderManageCats();
            modalCats.classList.remove('hidden');
        };

        document.getElementById('close-manage-cats').onclick = () => {
            modalCats.classList.add('hidden');
        };

        document.getElementById('btn-add-cat').onclick = () => {
            const inp = document.getElementById('input-new-cat');
            const val = inp.value.trim();
            if (val && !categories.includes(val)) {
                categories.push(val);
                inp.value = '';
                save();
                renderManageCats();
            }
        };
    }
}

function renderManageCats() {
    const list = document.getElementById('cats-list-container');
    if (!list) return;
    list.innerHTML = '';

    categories.forEach(cat => {
        const row = document.createElement('div');
        row.className = 'input-row';
        row.style.justifyContent = 'space-between';

        // Prevent deleting non-deletable if needed? Let's generic everything.
        // Maybe lock 'GENERAL'?
        const isLocked = cat === 'ОБЩИЕ';

        row.innerHTML = `
            <span style="font-weight:500;">${cat}</span>
            ${!isLocked ? `<button class="btn-text accent" style="color:#FF3B30;" onclick="deleteCat('${cat}')">Удалить</button>` : ''}
        `;
        list.appendChild(row);
    });
}

window.deleteCat = (cat) => {
    if (confirm('Удалить папку "' + cat + '"? Задачи останутся, но будут без папки (перейдут в Общие).')) {
        categories = categories.filter(c => c !== cat);
        // Move tasks to General
        tasks.forEach(t => {
            if (t.category === cat) t.category = 'ОБЩИЕ';
        });
        save();
        renderManageCats();
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
    localStorage.setItem('planner_tasks', JSON.stringify(tasks));
    localStorage.setItem('planner_categories', JSON.stringify(categories));
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

            if (!isAfterExpanded) {
                // Stack at TOP
                const topPos = TOP_OFFSET_PX + (index * HEADER_HEIGHT_PX);
                card.style.top = `${topPos}px`;
            } else {
                // Stack at BOTTOM
                const cardsBelow = total - index;
                const bottomOffset = 110 + (cardsBelow * HEADER_HEIGHT_PX);
                card.style.top = `calc(100vh - ${bottomOffset}px)`;
            }

            card.style.zIndex = 50 + index;

            if (expandedCategory === cat) {
                card.classList.add('expanded');
            } else {
                card.classList.remove('expanded');
            }

            const catTasks = tasks.filter(t => t.category === cat);
            const count = catTasks.filter(t => !t.completed).length;

            card.innerHTML = `
                <div class="card-header">
                    <h2>${cat}</h2>
                    <div class="counter-badge">${count > 0 ? count : ''}</div>
                </div>
                <div class="task-list" id="list-${cat}"></div>
            `;

            card.querySelector('.card-header').addEventListener('click', () => {
                toggleCard(cat);
            });

            stackContainer.appendChild(card);

            const listEl = card.querySelector(`#list-${cat}`);
            renderTasksForCategory(listEl, catTasks);
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

    modalTitle.innerText = "РЕДАКТИРОВАНИЕ";
    btnSave.innerText = "СОХРАНИТЬ";
    if (btnDelete) btnDelete.classList.remove('hidden');

    document.getElementById('input-title').value = task.title;
    document.getElementById('input-desc').value = task.description || '';
    document.getElementById('input-tags').value = (task.tags || []).toString();
    document.getElementById('input-time').value = task.time || '';

    selectedCategory = task.category;
    document.getElementById('label-cat').innerText = selectedCategory;
    selectedDate = task.date;
    updateDateLabel();

    modalAdd.classList.remove('hidden');
}

window.openTaskDetails = openTaskDetails;
