// State
let tasks = JSON.parse(localStorage.getItem('planner_tasks')) || [];
const defaultCategories = ['ОБЩИЕ', 'РАБОТА', 'ДОМ', 'ЛИЧНЫЕ'];
let categories = JSON.parse(localStorage.getItem('planner_categories')) || defaultCategories;

// DOM Elements
const stackContainer = document.getElementById('category-stack');
const modalAdd = document.getElementById('modal-add-task');
const inputDateNative = document.getElementById('input-date-native');
const labelDate = document.getElementById('label-date');
let selectedDate = null; // YYYY-MM-DD or null
let selectedCategory = 'ОБЩИЕ';
let activeCategoryCard = null; // Which card is currently on top/expanded

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

    // We render categories in reverse order visually so first is top
    // taking into account z-index.
    // Actually, physically they stack.
    categories.forEach((cat, index) => {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.style.top = `${index * 60}px`; // Header Offset
        card.style.zIndex = index + 1;

        // Calculate task counts
        const catTasks = tasks.filter(t => t.category === cat);
        const count = catTasks.filter(t => !t.completed).length;

        card.innerHTML = `
            <div class="card-header" onclick="toggleCard('${cat}')">
                <h2>${cat}</h2>
                <div class="counter-badge">${count > 0 ? count : ''}</div>
            </div>
            <div class="task-list" id="list-${cat}">
                <!-- Tasks go here -->
            </div>
        `;

        stackContainer.appendChild(card);

        // Render Tasks for this category
        const listEl = card.querySelector(`#list-${cat}`);
        renderTasksForCategory(listEl, catTasks);
    });

    // Adjust container height to fit at least the headers
    stackContainer.style.height = `${(categories.length * 60) + 400}px`;
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
            <div class="task-checkbox-area" onclick="toggleTask('${task.id}')">
                <div class="checkbox-circle"></div>
            </div>
            <div class="task-content" onclick="toggleTask('${task.id}')">
                <div class="task-title">${task.title}</div>
                <div class="meta-row">
                    ${isCritical && isOverdue ? '<div class="critical-label">ПРОСРОЧЕНО</div>' : ''}
                    ${isCritical && isToday ? '<div class="critical-label">СЕГОДНЯ</div>' : ''}
                </div>
            </div>
            ${infoText ? `<div class="info-pill">${infoText}</div>` : ''}
        `;

        // Add Delete Swipe/Button logic? For PWA simple button is easier.
        // Let's add a long-press delete or just a small x for now? 
        // Or strictly follow design - swipe. 
        // For simple PWA, let's keep it clickable.

        container.appendChild(div);
    });
}

function toggleTask(id) {
    const t = tasks.find(x => x.id === id);
    if (t) {
        t.completed = !t.completed;
        save();
    }
}

function toggleCard(cat) {
    // Simple stack accordion logic
    // For now, let's not overengineer animations. 
    // Just scrolling to it might be enough in this stack layout.
    // Or we expand it to full height.
    // Let's make it simple: clicking header scrolls/focuses that card.

    // In valid prototype, all cards are visible in stack.
}

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

    const newTask = {
        id: Date.now().toString(),
        title: title,
        description: document.getElementById('input-desc').value,
        category: selectedCategory,
        tags: document.getElementById('input-tags').value,
        time: document.getElementById('input-time').value,
        date: selectedDate, // Can be null
        completed: false
    };

    tasks.push(newTask);
    save();
    modalAdd.classList.add('hidden');
};

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
