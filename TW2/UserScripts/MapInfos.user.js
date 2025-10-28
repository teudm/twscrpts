(function() {
    'use strict';

    // --- ID ÚNICO PARA O MODAL ---
    const MODAL_ID = "tw2_scanner_modal";

    // --- CONSTANTES DE SCAN ---
    const SCAN_RADIUS = 50;  // Raio de 50 = 101x101 campos
    const CHUNK_SIZE = 50;   // Tamanho do bloco que a API retorna

    // --- 1. FUNÇÕES DE AJUDA (UI e CÁLCULOS) ---

    /** Adiciona o CSS para o modal e a tabela */
    function addStyles() {
        const styleId = `${MODAL_ID}_style`;
        if (document.getElementById(styleId)) return; // Não adiciona o estilo duas vezes

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #${MODAL_ID} {
                position: fixed;
                top: 100px;
                left: 100px;
                width: 650px;
                min-width: 400px;
                max-width: 90%;
                height: 500px;
                max-height: 70%;
                background: #f4e4bc; /* Cor de fundo do TW2 */
                border: 3px solid #6f4e37; /* Marrom escuro */
                z-index: 10001;
                box-shadow: 0 0 20px rgba(0,0,0,0.5);
                border-radius: 5px;
                display: flex;
                flex-direction: column;
                color: #000;
            }
            .${MODAL_ID}_header {
                padding: 8px 12px;
                background: #6f4e37; /* Marrom escuro */
                color: white;
                font-weight: bold;
                font-size: 16px;
                cursor: move;
                border-bottom: 2px solid #5a3f2d;
                border-radius: 3px 3px 0 0;
            }
            .${MODAL_ID}_close {
                float: right;
                font-size: 20px;
                font-weight: bold;
                cursor: pointer;
                line-height: 1;
            }
            .${MODAL_ID}_close:hover {
                color: #ccc;
            }
            .${MODAL_ID}_content {
                padding: 10px;
                overflow-y: auto;
                flex-grow: 1;
                background: #fdf5e6; /* Fundo de papiro */
            }
            .${MODAL_ID}_content p {
                font-size: 13px;
                margin-bottom: 10px;
                text-align: center;
                color: #333;
            }
            .${MODAL_ID}_table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
            }
            .${MODAL_ID}_table th, .${MODAL_ID}_table td {
                border: 1px solid #c1a264; /* Borda cor de papiro */
                padding: 4px 6px;
                text-align: left;
            }
            .${MODAL_ID}_table th {
                background: #f4e4bc;
                position: sticky;
                top: -1px; 
            }
            /* Cores das linhas */
            .${MODAL_ID}_table tr:nth-child(even) {
                background-color: #f7eedf;
            }
            .${MODAL_ID}_table tr.own-village { background-color: #f3e5f5 !important; }
            .${MODAL_ID}_table tr.ally-village { background-color: #e3f2fd !important; }
            .${MODAL_ID}_table tr.barb-village { background-color: #f0f0f0 !important; }
        `;
        document.head.appendChild(style);
    }

    /** Cria o modal base e a estrutura da tabela */
    function createModal(centerX, centerY) {
        // Remove modal antigo, se existir
        const oldModal = document.getElementById(MODAL_ID);
        if (oldModal) {
            oldModal.remove();
        }

        const modal = document.createElement('div');
        modal.id = MODAL_ID;
        
        modal.innerHTML = `
            <div class="${MODAL_ID}_header">
                Scanner de Mapa (101x101)
                <span class="${MODAL_ID}_close">&times;</span>
            </div>
            <div class="${MODAL_ID}_content">
                <p>Escaneando ao redor de ${centerX}|${centerY}. Aguarde...</p>
                <table class="${MODAL_ID}_table">
                    <thead>
                        <tr>
                            <th>Dist.</th>
                            <th>Aldeia</th>
                            <th>Coords</th>
                            <th>Pontos</th>
                            <th>Dono (ID)</th>
                            <th>Tribo (ID)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td colspan="6" style="text-align: center;">Carregando dados...</td></tr>
                    </tbody>
                </table>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Adicionar evento de fechar
        modal.querySelector(`.${MODAL_ID}_close`).onclick = () => modal.remove();
        
        // Adicionar lógica de "arrastar" (draggable)
        makeDraggable(modal, modal.querySelector(`.${MODAL_ID}_header`));
    }

    /** Torna um elemento 'el' arrastável por um 'handle' */
    function makeDraggable(el, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            el.style.top = (el.offsetTop - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    /** Calcula a distância entre duas aldeias (objetos com .x e .y) */
    function calculateDistance(v1, v2) {
         return Math.sqrt(Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2));
    }

    /** Preenche a tabela com os dados das aldeias */
    function populateTable(villagesMap, myPlayerId, myTribeId, centerX, centerY) {
        const tbody = document.querySelector(`#${MODAL_ID} .${MODAL_ID}_table tbody`);
        if (!tbody) return;

        const contentDiv = document.querySelector(`#${MODAL_ID} .${MODAL_ID}_content p`);
        contentDiv.textContent = `Scan concluído. ${villagesMap.size} aldeias únicas encontradas.`;

        // Converter Map para Array, calcular distância e ordenar
        const villagesArray = Array.from(villagesMap.values()).map(v => {
            v.dist = calculateDistance(v, {x: centerX, y: centerY});
            return v;
        }).sort((a, b) => a.dist - b.dist);

        // Limpar "Carregando..."
        tbody.innerHTML = "";

        // Preencher
        villagesArray.forEach(v => {
            const tr = document.createElement('tr');
            
            // Adicionar classes para estilo
            if (v.owner_id === myPlayerId) { 
                tr.classList.add('own-village');
            } else if (v.tribe_id === myTribeId && myTribeId !== null) {
                tr.classList.add('ally-village');
            } else if (v.owner_id === 0) {
                tr.classList.add('barb-village');
            }
            
            tr.innerHTML = `
                <td>${v.dist.toFixed(2)}</td>
                <td>${v.name}</td>
                <td>${v.x}|${v.y}</td>
                <td>${v.points.toLocaleString('pt-BR')}</td>
                <td>${v.owner_id || 'Bárbara'}</td>
                <td>${v.tribe_id || '---'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // --- 2. FUNÇÃO PRINCIPAL (SCAN) ---

    function runScan() {
        console.log("Iniciando Scanner de Mapa TW2...");

        let socketService, routeProvider, modelDataService;
        
        // 2.1. Obter serviços do jogo
        try {
            // 'injector' é pego do escopo global (console)
            socketService = injector.get('socketService');
            routeProvider = injector.get('routeProvider');
            modelDataService = injector.get('modelDataService');
        } catch (e) {
            console.error("Erro ao carregar serviços. O 'injector' está disponível?", e);
            alert("Erro: Não foi possível carregar os serviços do jogo. O 'injector' está disponível no console?");
            return;
        }

        // 2.2. Obter dados do jogador e aldeia atual
        const currentVillage = modelDataService.getSelectedVillage().data;
        const myPlayer = modelDataService.getSelectedCharacter().data;
        const myPlayerId = myPlayer.characted_id;
        const myTribeId = myPlayer.tribeId;
        const centerX = currentVillage.x;
        const centerY = currentVillage.y;

        console.log(`TW2 Scanner: Iniciando scan centrado em ${centerX}|${centerY}`);
        console.log(`TW2 Scanner: Player ID: ${myPlayerId} | Tribe ID: ${myTribeId}`);

        // 2.3. Criar a UI (Modal e Estilos)
        addStyles();
        createModal(centerX, centerY);

        const allPromises = [];
        const allVillages = new Map(); // Usamos um Map para remover duplicatas automaticamente

        // 2.4. Lógica de "Tiling" (divisão em blocos)
        const startX = centerX - SCAN_RADIUS;
        const startY = centerY - SCAN_RADIUS;
        const endX = centerX + SCAN_RADIUS;
        const endY = centerY + SCAN_RADIUS;

        for (let x = startX; x <= endX; x += CHUNK_SIZE) {
            for (let y = startY; y <= endY; y += CHUNK_SIZE) {
                
                // 2.5. Cria uma Promise para cada requisição de bloco
                const promise = new Promise((resolve, reject) => {
                    const payload = {
                        x: x,
                        y: y,
                        width: CHUNK_SIZE,
                        height: CHUNK_SIZE
                    };
                    
                    // 2.6. Faz a requisição
                    socketService.emit(routeProvider.MAP_GETVILLAGES, payload, (data) => {
                        if (data && data.villages) {
                            resolve(data.villages);
                        } else {
                            console.warn(`TW2 Scanner: Bloco em ${x}|${y} não retornou aldeias.`, data);
                            resolve([]); // Resolve com array vazio para não quebrar o Promise.all
                        }
                    });
                });
                allPromises.push(promise);
            }
        }

        console.log(`TW2 Scanner: Enviando ${allPromises.length} requisições de blocos...`);

        // 2.7. Espera TODAS as requisições terminarem
        Promise.all(allPromises).then(results => {
            // 'results' é um array de arrays, ex: [ [aldeias_bloco1], [aldeias_bloco2], ... ]
            
            results.forEach(villageArray => {
                villageArray.forEach(village => {
                    // Adiciona ao Map. Se a ID já existir, ela é simplesmente substituída.
                    allVillages.set(village.id, village);
                });
            });

            console.log(`--- SCAN CONCLUÍDO ---`);
            console.log(`Total de ${allVillages.size} aldeias únicas encontradas.`);
            
            // 2.8. Popular a tabela
            populateTable(allVillages, myPlayerId, myTribeId, centerX, centerY);

        }).catch(error => {
            console.error("TW2 Scanner: Erro fatal durante o scan.", error);
            const contentP = document.querySelector(`#${MODAL_ID} .${MODAL_ID}_content p`);
            if (contentP) contentP.textContent = "Erro no scan. Veja o console (F12).";
        });
    }

    // --- 3. INICIA O SCRIPT ---
    runScan();

})();