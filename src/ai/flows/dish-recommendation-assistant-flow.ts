'use server';
/**
 * @fileOverview An AI assistant flow that provides dish recommendations based on user preferences.
 *
 * - dishRecommendationAssistant - A function that handles the dish recommendation process.
 * - DishRecommendationAssistantInput - The input type for the dishRecommendationAssistant function.
 * - DishRecommendationAssistantOutput - The return type for the dishRecommendationAssistant function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const DishRecommendationAssistantInputSchema = z.object({
  preferences: z
    .string()
    .describe(
      'User preferences for a dish, e.g., "something spicy", "vegetarian", "light meal", or "popular items".'
    ),
});
export type DishRecommendationAssistantInput = z.infer<
  typeof DishRecommendationAssistantInputSchema
>;

const DishRecommendationAssistantOutputSchema = z.object({
  recommendations: z
    .array(
      z.object({
        name: z.string().describe('The name of the recommended dish.'),
        description: z
          .string()
          .describe('A brief description of the recommended dish.'),
        reason: z
          .string()
          .optional()
          .describe(
            'The reason why this dish is recommended based on the user\'s preferences.'
          ),
      })
    )
    .describe('A list of recommended dishes.'),
});
export type DishRecommendationAssistantOutput = z.infer<
  typeof DishRecommendationAssistantOutputSchema
>;

export async function dishRecommendationAssistant(
  input: DishRecommendationAssistantInput
): Promise<DishRecommendationAssistantOutput> {
  return dishRecommendationAssistantFlow(input);
}

const prompt = ai.definePrompt({
  name: 'dishRecommendationAssistantPrompt',
  input: { schema: DishRecommendationAssistantInputSchema },
  output: { schema: DishRecommendationAssistantOutputSchema },
  prompt: `You are an AI assistant for a digital restaurant menu. Your goal is to suggest dishes or combinations to a customer based on their preferences or popular items.

Consider a diverse menu with various cuisines and dietary options. If specific menu items are not provided, suggest popular or common dishes that fit the description.

User's preferences: "{{{preferences}}}"

Provide at least 3 distinct dish recommendations, including their name, a short description, and a brief reason why it matches the user's preferences.`,
});

const dishRecommendationAssistantFlow = ai.defineFlow(
  {
    name: 'dishRecommendationAssistantFlow',
    inputSchema: DishRecommendationAssistantInputSchema,
    outputSchema: DishRecommendationAssistantOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
