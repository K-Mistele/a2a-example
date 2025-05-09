import { Hono } from 'hono';
import type { AgentCard } from '../types/AgentCard';

const wellKnown = new Hono();

wellKnown.get('/agent.json', (c) => c.json({
	name: 'Stagehand agent',
	description:
		'An agent that helps you drive a web browser playwright-style with the Browserable framework',
	url: 'http://localhost:3000/a2a/api',
    provider: {
        organization: 'Kyle Mistele',
        url: null
    },
	version: '0.0.1',
    capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: false,
    },
    authentication: {
        schemes: ['Bearer'],
        credentials: null
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'image/png'],
    skills: [
        {
            id: 'complete-browser-task',
            name: 'Complete Task in Browser',
            description: 'Complete a task or action in a web browser based on the provided instructions.',
            tags: ['browser', 'playwright'],
            examples: [
                'Find a list of nail salons in the Uptown Dallas area, and export the results to a CSV file.',
            ],
            inputModes: ['text/plain', 'application/json'],
            outputModes: ['application/json'],

        },
        {
            id: 'screenshot-browser-page',
            name: 'Screenshot Browser Page',
            description: 'Navigate to a given URL, complete some actions, and take a screenshot of the page.',
            tags: ['browser', 'playwright'],
            examples: [
                'Navigate to https://www.google.com/maps, search for "Dallas nail salons", and take a screenshot of the results.',
            ],
            inputModes: ['application/json'],
            outputModes: ['image/png'],
            
        }
    ]
   } satisfies AgentCard));

export default wellKnown;
