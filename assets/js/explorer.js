(() => {
    'use strict';

    const page = window.EXPLORER_PAGE;
    if (!page?.components || !page?.simulationSteps || !page?.initialComponent) {
        throw new Error('EXPLORER_PAGE configuration is incomplete.');
    }

    const CONFIG = {
        width: 1920,
        height: 1080,
        zoomMin: 0.25,
        zoomMax: 2.5,
        zoomStep: 0.18
    };

    const state = {
        scale: 0.75,
        panX: 0,
        panY: 0,
        pointerId: null,
        pointerStartX: 0,
        pointerStartY: 0,
        panStartX: 0,
        panStartY: 0,
        dragDistance: 0,
        suppressClickUntil: 0,
        activeComponent: null,
        simulationActive: false,
        simStep: 1,
        transformFrame: 0,
        wheelTimer: 0,
        pulseAnimation: 0
    };

    const viewport = document.getElementById('canvasViewport');
    const content = document.getElementById('canvasContent');
    const lblZoomRatio = document.getElementById('lblZoomRatio');
    const sidePanel = document.getElementById('sideDetailPanel');
    const simulationCard = document.getElementById('simulationCard');
    const svg = document.getElementById('jvmSvg');

    function applyTransform() {
        state.transformFrame = 0;
        content.style.transform = `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.scale})`;
        lblZoomRatio.textContent = `${Math.round(state.scale * 100)}%`;
    }

    function requestTransform() {
        if (!state.transformFrame) state.transformFrame = requestAnimationFrame(applyTransform);
    }

    function setDirectManipulation(active) {
        content.classList.toggle('is-direct-manipulation', active);
    }

    function isUiControl(target) {
        return Boolean(target.closest('#simulationCard, #sideDetailPanel, button, a'));
    }

    viewport.addEventListener('pointerdown', (event) => {
        if (isUiControl(event.target) || state.pointerId !== null) return;

        state.pointerId = event.pointerId;
        state.pointerStartX = event.clientX;
        state.pointerStartY = event.clientY;
        state.panStartX = state.panX;
        state.panStartY = state.panY;
        state.dragDistance = 0;

        setDirectManipulation(true);
        viewport.classList.add('is-dragging');
    });

    window.addEventListener('pointermove', (event) => {
        if (event.pointerId !== state.pointerId) return;

        const deltaX = event.clientX - state.pointerStartX;
        const deltaY = event.clientY - state.pointerStartY;
        state.dragDistance = Math.max(state.dragDistance, Math.hypot(deltaX, deltaY));
        state.panX = state.panStartX + deltaX;
        state.panY = state.panStartY + deltaY;
        requestTransform();
    });

    function finishPointer(event) {
        if (event.pointerId !== state.pointerId) return;
        if (state.dragDistance > 4) state.suppressClickUntil = performance.now() + 120;

        viewport.classList.remove('is-dragging');
        state.pointerId = null;
        setDirectManipulation(false);
    }

    window.addEventListener('pointerup', finishPointer);
    window.addEventListener('pointercancel', finishPointer);

    viewport.addEventListener('wheel', (event) => {
        event.preventDefault();
        setDirectManipulation(true);

        const bounds = viewport.getBoundingClientRect();
        const pointerX = event.clientX - bounds.left;
        const pointerY = event.clientY - bounds.top;
        const contentX = (pointerX - state.panX) / state.scale;
        const contentY = (pointerY - state.panY) / state.scale;
        const factor = Math.exp(-event.deltaY * 0.0051);
        const nextScale = Math.max(CONFIG.zoomMin, Math.min(CONFIG.zoomMax, state.scale * factor));

        state.scale = nextScale;
        state.panX = pointerX - contentX * nextScale;
        state.panY = pointerY - contentY * nextScale;
        requestTransform();

        window.clearTimeout(state.wheelTimer);
        state.wheelTimer = window.setTimeout(() => setDirectManipulation(false), 100);
    }, { passive: false });

    function zoomAround(centerX, centerY, nextScale, animate = true) {
        const contentX = (centerX - state.panX) / state.scale;
        const contentY = (centerY - state.panY) / state.scale;
        state.scale = Math.max(CONFIG.zoomMin, Math.min(CONFIG.zoomMax, nextScale));
        state.panX = centerX - contentX * state.scale;
        state.panY = centerY - contentY * state.scale;
        setDirectManipulation(!animate);
        applyTransform();
        if (!animate) requestAnimationFrame(() => setDirectManipulation(false));
    }

    document.getElementById('btnZoomIn').addEventListener('click', () => {
        zoomAround(viewport.clientWidth / 2, viewport.clientHeight / 2, state.scale + CONFIG.zoomStep);
    });

    document.getElementById('btnZoomOut').addEventListener('click', () => {
        zoomAround(viewport.clientWidth / 2, viewport.clientHeight / 2, state.scale - CONFIG.zoomStep);
    });

    function resetViewToDefault(animate = true) {
        const viewW = viewport.clientWidth;
        const viewH = viewport.clientHeight;
        state.scale = Math.min(viewW / CONFIG.width, viewH / CONFIG.height) * 0.9;
        state.panX = (viewW - CONFIG.width * state.scale) / 2;
        state.panY = (viewH - CONFIG.height * state.scale) / 2;
        setDirectManipulation(!animate);
        applyTransform();
        if (!animate) requestAnimationFrame(() => setDirectManipulation(false));
    }

    document.getElementById('btnResetZoom').addEventListener('click', () => resetViewToDefault());

    function getRootSvgBBox(element) {
        const bbox = element.getBBox();
        const transforms = [];
        let current = element;

        while (current && current !== svg) {
            const transformList = current.transform?.baseVal;
            const consolidated = transformList?.numberOfItems ? transformList.consolidate() : null;
            if (consolidated) transforms.unshift(consolidated.matrix);
            current = current.parentElement;
        }

        let matrix = svg.createSVGMatrix();
        transforms.forEach((transform) => { matrix = matrix.multiply(transform); });

        const corners = [
            [bbox.x, bbox.y],
            [bbox.x + bbox.width, bbox.y],
            [bbox.x, bbox.y + bbox.height],
            [bbox.x + bbox.width, bbox.y + bbox.height]
        ].map(([x, y]) => {
            const point = svg.createSVGPoint();
            point.x = x;
            point.y = y;
            return point.matrixTransform(matrix);
        });

        const xs = corners.map((point) => point.x);
        const ys = corners.map((point) => point.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        return {
            x: minX,
            y: minY,
            width: Math.max(...xs) - minX,
            height: Math.max(...ys) - minY
        };
    }

    function zoomToComponent(id) {
        const element = document.getElementById(id);
        if (!element) return;

        const bbox = getRootSvgBBox(element);
        const viewW = viewport.clientWidth;
        const viewH = viewport.clientHeight;
        const panelW = sidePanel.getBoundingClientRect().width;
        const availableW = Math.max(320, viewW - panelW);
        const padding = 72;
        const fitScale = Math.min(
            (availableW - padding * 2) / Math.max(bbox.width, 1),
            (viewH - padding * 2) / Math.max(bbox.height, 1)
        );

        state.scale = Math.max(CONFIG.zoomMin, Math.min(1.25, fitScale));
        state.panX = availableW / 2 - (bbox.x + bbox.width / 2) * state.scale;
        state.panY = viewH / 2 - (bbox.y + bbox.height / 2) * state.scale;
        setDirectManipulation(false);
        applyTransform();
    }

    function componentRects(element) {
        return Array.from(element.children).filter((child) =>
            child.tagName?.toLowerCase() === 'rect' && child.hasAttribute('stroke')
        );
    }

    function restoreComponentOutlines() {
        document.querySelectorAll('svg g[id^="block_"]').forEach((element) => {
            componentRects(element).forEach((rect) => {
                if (!rect.dataset.originalStroke) rect.dataset.originalStroke = rect.getAttribute('stroke');
                rect.setAttribute('stroke', rect.dataset.originalStroke);
            });
        });
    }

    function selectComponent(id) {
        const data = page.components[id];
        if (!data) return;

        restoreComponentOutlines();
        const selected = document.getElementById(id);
        componentRects(selected).forEach((rect) => rect.setAttribute('stroke', '#e5c07b'));

        state.activeComponent = id;
        document.getElementById('detailFallback').classList.add('hidden');
        document.getElementById('detailMain').classList.remove('hidden');
        document.getElementById('detailTitle').querySelector('span').textContent = data.title;
        document.getElementById('detailDesc').innerHTML = data.desc;

        const tags = document.getElementById('detailTags');
        tags.replaceChildren(...data.tags.map((tag) => {
            const span = document.createElement('span');
            span.className = 'bg-[#2d3139] text-[#61afef] text-xs px-2.5 py-1 rounded-full border border-[#3e4451] font-semibold';
            span.textContent = tag;
            return span;
        }));

        document.getElementById('microVisualTitle').textContent = data.microTitle;
        document.getElementById('microContent').innerHTML = data.micro;

        const qna = document.getElementById('detailQnA');
        qna.innerHTML = '';
        data.questions.forEach((item) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'bg-[#14161b] p-3.5 rounded-xl border border-[#2d3139] space-y-2';
            wrapper.innerHTML = `<p class="text-xs font-bold text-[#e5c07b] flex items-start gap-1"><span class="bg-[#2d3139] text-[#e5c07b] px-1.5 rounded text-[10px] uppercase font-extrabold border border-[#3e4451]">Q</span><span>${item.q}</span></p><p class="text-xs text-[#abb2bf] leading-relaxed">${item.a}</p>`;
            qna.appendChild(wrapper);
        });

        sidePanel.classList.remove('translate-x-full');
        zoomToComponent(id);
    }

    document.getElementById('btnClosePanel').addEventListener('click', () => {
        sidePanel.classList.add('translate-x-full');
        restoreComponentOutlines();
        resetViewToDefault();
    });

    document.querySelectorAll('svg g[id^="block_"]').forEach((element) => {
        element.addEventListener('click', (event) => {
            event.stopPropagation();
            if (performance.now() < state.suppressClickUntil) return;
            selectComponent(element.id);
        });
    });

    function stopPulse() {
        if (state.pulseAnimation) cancelAnimationFrame(state.pulseAnimation);
        state.pulseAnimation = 0;
        document.getElementById('simPulse')?.setAttribute('opacity', '0');
    }

    function animatePulse(step) {
        const pulse = document.getElementById('simPulse');
        if (!pulse || !step.pulseFrom || !step.pulseTo) return;

        stopPulse();
        pulse.setAttribute('opacity', '0.8');
        const start = performance.now();
        const duration = 1000;

        function frame(now) {
            const progress = Math.min((now - start) / duration, 1);
            pulse.setAttribute('cx', step.pulseFrom[0] + (step.pulseTo[0] - step.pulseFrom[0]) * progress);
            pulse.setAttribute('cy', step.pulseFrom[1] + (step.pulseTo[1] - step.pulseFrom[1]) * progress);
            if (progress < 1 && state.simulationActive && state.simStep === step.step) {
                state.pulseAnimation = requestAnimationFrame(frame);
            }
        }

        state.pulseAnimation = requestAnimationFrame(frame);
    }

    function runSimulationStep(stepNumber) {
        const step = page.simulationSteps.find((item) => item.step === stepNumber);
        if (!step) return;

        document.getElementById('simStepTitle').textContent = step.title;
        document.getElementById('simStepDesc').innerHTML = step.desc;
        document.getElementById('simProgress').textContent = `Step ${stepNumber} / ${page.simulationSteps.length}`;

        const logs = document.getElementById('simLogList');
        logs.innerHTML = '';
        step.logs.forEach((log) => {
            const item = document.createElement('div');
            item.className = 'text-[#abb2bf] flex gap-1.5';
            item.innerHTML = `<span class="text-[#98c379] font-bold shrink-0">✓</span><span>${log.replace(/^✓\s*/, '')}</span>`;
            logs.appendChild(item);
        });

        document.getElementById('btnPrevSimStep').disabled = stepNumber === 1;
        document.getElementById('btnNextSimStep').innerHTML = stepNumber === page.simulationSteps.length
            ? '<span>완료</span><i class="fa-solid fa-check"></i>'
            : '<span>다음</span><i class="fa-solid fa-arrow-right"></i>';
        document.getElementById('simProgressBar').style.width = `${stepNumber / page.simulationSteps.length * 100}%`;

        selectComponent(step.targetBlock);
        animatePulse(step);
        page.updateSimulationVisuals?.(stepNumber);
    }

    document.getElementById('btnStartSimulation').addEventListener('click', () => {
        state.simulationActive = true;
        state.simStep = 1;
        simulationCard.classList.remove('hidden');
        requestAnimationFrame(() => simulationCard.classList.remove('opacity-0'));
        runSimulationStep(1);
    });

    document.getElementById('btnExitSim').addEventListener('click', () => {
        simulationCard.classList.add('opacity-0');
        window.setTimeout(() => simulationCard.classList.add('hidden'), 300);
        state.simulationActive = false;
        stopPulse();
        page.resetSimulationVisuals?.();
        resetViewToDefault();
    });

    document.getElementById('btnNextSimStep').addEventListener('click', () => {
        if (state.simStep < page.simulationSteps.length) {
            state.simStep += 1;
            runSimulationStep(state.simStep);
        } else {
            document.getElementById('btnExitSim').click();
        }
    });

    document.getElementById('btnPrevSimStep').addEventListener('click', () => {
        if (state.simStep > 1) {
            state.simStep -= 1;
            runSimulationStep(state.simStep);
        }
    });

    window.addEventListener('resize', () => resetViewToDefault(false));
    resetViewToDefault(false);
    selectComponent(page.initialComponent);
})();
