// State
// Helper for safe parsing
function safeParse(key, def) {
    try {
        return JSON.parse(localStorage.getItem(key)) || def;
    } catch (e) {
        return def;
    }
}
// State
let tasks = safeParse('planner_tasks', []);
const defaultCategories = ['ОБЩИЕ', 'РАБОТА', 'ДОМ', 'ЛИЧНЫЕ'];
let categories = safeParse('planner_categories', defaultCategories);

// DOM Elements
const stackContainer = document.getElementById('category-stack');
const modalAdd = document.getElementById('modal-add-task');
const inputDateNative = document.getElementById('input-date-native');
const labelDate = document.getElementById('label-date');
let selectedDate = null; // YYYY-MM-DD or null
let selectedCategory = 'ОБЩИЕ';
// Header height settings
const HEADER_HEIGHT_PX = 60;
const HEADER_HEIGHT_REM = 4; // approx
const TOP_OFFSET_PX = 10; // Small margin inside the stack container

// Init
document.addEventListener('DOMContentLoaded', () => {
    updateHeaderDate();
    renderStack();
    setupEventListeners();
});

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
    renderStack(); // Full re-render is easiest for this scale
}

// Rendering
function renderStack() {
    stackContainer.innerHTML = '';

    const total = categories.length;
    let currentY = 0;

    // Determine if we have an expanded card
    // If nothing is expanded, default to first or none?
    // Let's default to first expand if null
    if (!expandedCategory && categories.length > 0) expandedCategory = categories[0];

    // Find index of expanded
    const expIndex = categories.indexOf(expandedCategory);

    categories.forEach((cat, index) => {
        const card = document.createElement('div');
        card.className = 'category-card';

        // Stack Logic (Detailed Accordion)
        const isAfterExpanded = index > expIndex;

        // We use absolute positioning relative to window height to be safe.
        // Top Stack: standard offset + index * header
        // Bottom Stack: 100vh - dock(90) - ((total-index) * header)

        if (!isAfterExpanded) {
            // Stack at TOP
            const topPos = TOP_OFFSET_PX + (index * HEADER_HEIGHT_PX);
            card.style.top = `${topPos}px`;
            // If this IS the expanded card, it needs to be tall.
            // But height is 100% by css, so it's fine.
        } else {
            // Stack at BOTTOM (Push down)
            const cardsBelow = total - index;
            // 90px dock + 20px padding
            const bottomOffset = 110 + (cardsBelow * HEADER_HEIGHT_PX);
            card.style.top = `calc(100vh - ${bottomOffset}px)`;
        }

        card.style.zIndex = 50 + index; // Higher index on top
        // Ensure expanded card is accessible
        if (expandedCategory === cat) {
            card.classList.add('expanded');
        } else {
            card.classList.remove('expanded');
        }

        // Calculate task counts
        const catTasks = tasks.filter(t => t.category === cat);
        const count = catTasks.filter(t => !t.completed).length;

        card.innerHTML = `
            <div class="card-header">
                <h2>${cat}</h2>
                <div class="counter-badge">${count > 0 ? count : ''}</div>
            </div>
            <div class="task-list" id="list-${cat}">
                <!-- Tasks go here -->
            </div>
        `;

        // Attach Event Listeners explicitly
        card.querySelector('.card-header').addEventListener('click', () => {
            toggleCard(cat);
        });

        stackContainer.appendChild(card);

        // Render Tasks for this category
        const listEl = card.querySelector(`#list-${cat}`);
        renderTasksForCategory(listEl, catTasks);
    });
}

function renderTasksForCategory(container, taskList) {
    const today = getTodayStr();

    // Sort: Incomplete first, then by date/time
    taskList.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        // Logic: specific date priorities
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
            // Future date logic: show "do DD.MM"
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

        // Attach listeners
        // Checkbox -> Toggle
        const checkboxArea = div.querySelector('.task-checkbox-area');
        checkboxArea.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger body click
            toggleTask(task.id);
        });

        // Body -> View Details/Edit
        const contentArea = div.querySelector('.task-content');
        contentArea.addEventListener('click', (e) => {
            e.stopPropagation();
            openTaskDetails(task);
        });

        // Also bind the info pill if it exists
        const infoPill = div.querySelector('.info-pill');
        if (infoPill) {
            infoPill.addEventListener('click', (e) => {
                e.stopPropagation();
                openTaskDetails(task);
            });
        }

        container.appendChild(div);
    });
}

// Task Details / Edit Logic
let currentEditingTaskId = null;

function openTaskDetails(task) {
    currentEditingTaskId = task.id;

    // Populate Edit Modal (Reuse Add Modal or separate? Let's genericize the modal)
    // We will use the same modal but changing title and buttons.
    const modalTitle = document.getElementById('modal-title');
    const btnSave = document.getElementById('btn-save-task');
    const btnDelete = document.getElementById('btn-delete-task'); // We need to add this to HTML

    modalTitle.innerText = "РЕДАКТИРОВАНИЕ";
    btnSave.innerText = "СОХРАНИТЬ";

    // Show delete button
    if (btnDelete) btnDelete.classList.remove('hidden');

    document.getElementById('input-title').value = task.title;
    document.getElementById('input-desc').value = task.description || '';
    document.getElementById('input-tags').value = (task.tags || []).toString(); // simple array to string
    document.getElementById('input-time').value = task.time || '';

    selectedCategory = task.category;
    document.getElementById('label-cat').innerText = selectedCategory;

    selectedDate = task.date;
    updateDateLabel();

    modalAdd.classList.remove('hidden');
}

// Fix Add Button to reset state
document.getElementById('nav-add').onclick = () => {
    currentEditingTaskId = null; // New task mode

    document.getElementById('modal-title').innerText = "НОВАЯ ЗАДАЧА";
    document.getElementById('btn-save-task').innerText = "СОЗДАТЬ";
    const btnDelete = document.getElementById('btn-delete-task');
    if (btnDelete) btnDelete.classList.add('hidden');

    // Reset form
    document.getElementById('input-title').value = '';
    document.getElementById('input-desc').value = '';
    document.getElementById('input-tags').value = '';
    document.getElementById('input-time').value = '';
    selectedDate = null;
    updateDateLabel();
    selectedCategory = expandedCategory || categories[0]; // Default to current category
    document.getElementById('label-cat').innerText = selectedCategory;

    modalAdd.classList.remove('hidden');
};

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

// Make explicit for HTML onclick
window.toggleCard = toggleCard;
window.toggleTask = toggleTask;

// Adding Tasks
document.getElementById('nav-add').onclick = () => {
    // Reset form
    document.getElementById('input-title').value = '';
    document.getElementById('input-desc').value = '';
    document.getElementById('input-tags').value = '';
    document.getElementById('input-time').value = '';
    selectedDate = null;
    updateDateLabel();
    selectedCategory = categories[0];
    document.getElementById('label-cat').innerText = selectedCategory;

    modalAdd.classList.remove('hidden');
};

document.getElementById('close-add-task').onclick = () => {
    modalAdd.classList.add('hidden');
};

document.getElementById('btn-save-task').onclick = () => {
    const title = document.getElementById('input-title').value.trim();
    if (!title) return;

    if (currentEditingTaskId) {
        // Edit Mode
        const taskIndex = tasks.findIndex(t => t.id === currentEditingTaskId);
        if (taskIndex > -1) {
            tasks[taskIndex] = {
                ...tasks[taskIndex], // keep id and other props
                title: title,
                description: document.getElementById('input-desc').value,
                category: selectedCategory,
                tags: document.getElementById('input-tags').value, // Needs split? Let's keep existing logic if any
                time: document.getElementById('input-time').value,
                date: selectedDate
            };
        }
    } else {
        // Create Mode
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

// Add Delete Button Logic (will need HTML update)
// We'll attach it safely just in case HTML isn't updated same tick, but we will update HTML next.
setTimeout(() => {
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
}, 500);

// Date Picking
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

// Category Picker (Simple dropdown toggle)
document.getElementById('btn-pick-cat').onclick = () => {
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
