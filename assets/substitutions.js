// Ingredient substitutions.
// In a recipe's view, any ingredient line that matches an entry gets a "⇄ Swap" button that opens it.
// There are two kinds of entry:
//  - Tables (`columns` + `rows`): the same ingredient in different forms, such as fresh, dried and
//    powdered onion. If the line's amount matches a row (for example "1/2 cup chopped onion"), that
//    row is highlighted.
//  - Option lists (`options`): other ingredients that can stand in. Amounts written in [square
//    brackets] are scaled to the recipe's amount: a recipe with 1/2 cup buttermilk sees the 1 cup
//    entry halved. Write a count as [amount|singular|plural], such as [2|egg yolk|egg yolks].
// To add a substitution, add an entry to SUBSTITUTIONS. When a line matches several entries, the one
// whose match comes first in the line wins. Phrases matched by `exclude` are ignored before matching,
// so "coconut milk" can be kept away from the milk entry without hiding the coconut milk entry.
(() => {
  'use strict';

  const ALMANAC = { name: "The Old Farmer's Almanac", url: 'https://www.almanac.com/content/common-ingredient-substitutions' };

  // ---------- Herb helpers (fresh vs. dried) ----------
  const HERB = /\b(?:basil|oregano|thyme|rosemary|parsley|dill(?:\s?weed)?|sage|tarragon|marjoram|chives|mint|savory|herbs)\b/i;
  const HERB_EXCLUDE = /\bitalian\s+(?:seasoning|herbs)\b|\bherbes?\s+de\s+provence\b|\bdill\s+pickles?\b|\bpeppermint\b|\bmint\s+(?:extract|chocolate|chips|jelly|sauce)\b|\bsage\s+sausage\b|\bparsley\s+root\b/gi;
  const looksDried = line => /\bdried\b|\bdry\b|\bflakes\b|\bcrushed\b|\bground\b|\brubbed\b/i.test(line)
    || !/\bfresh\b|\bchopped\b|\bminced\b|\bsprigs?\b|\bleaves\b|\bbunch\b|\bsnipped\b|\btorn\b|\bsliced\b|\bhandful\b/i.test(line);

  const SUBSTITUTIONS = [
    // ===== Tables =====
    {
      id: 'onion',
      title: 'Onion substitutions',
      // Lines that mention onion, but not green/spring onions or scallions, which are a different ingredient.
      match: /\bonions?\b/i,
      exclude: /\b(?:green|spring)\s+onions?\b|\bscallions?\b|\bonion\s+soup\s+mix\b/gi,
      columns: ['Chopped fresh onion', 'Dried minced onion', 'Onion powder'],
      // Which column an ingredient line is written in.
      columnOf: line =>
        /\bonion\s+powder\b/i.test(line) ? 2
          : /\b(?:dried|dehydrated|instant)\s+(?:minced\s+)?onions?\b|\bminced\s+dried\s+onions?\b|\bonion\s+flakes\b/i.test(line) ? 1
            : 0,
      rows: [
        ['1/4 cup', '3/4 tablespoon', '3/4 teaspoon'],
        ['1/3 cup', '1 tablespoon', '1 teaspoon'],
        ['1/2 cup', '1-1/2 tablespoons', '1/2 tablespoon'],
        ['2/3 cup', '2 tablespoons', '2 teaspoons'],
        ['3/4 cup', '2-1/4 tablespoons', '2-1/4 teaspoons'],
        ['1 cup', '3 tablespoons', '1 tablespoon']
      ],
      // Shown in a box below the table or list: a sentence, or a list of lines for bullet points.
      // Leave it out for no note.
      note: [
        'Small onion — about the size of a Roma tomato — will give you 4 ounces or ½ cup chopped.',
        'Medium onion — about the size of a turnip — will give you 8 ounces or 1 cup chopped.',
        'Large onion — about the size of a pomegranate — will give you 12 ounces or 1-½ cups chopped.',
        "The Old Farmer's Almanac lists 1 small chopped onion = 1 tablespoon dried minced onion, 1 teaspoon onion powder, or 1/4 cup frozen chopped onion."
      ]
    },

    // ===== Option lists from The Old Farmer's Almanac =====
    // base: the amount the options are written for ('' or leave out when the Almanac gives none).
    // name: the ingredient, shown after the base ("For 1 cup buttermilk").
    // equiv: other units a recipe might use, as how many of `base` one of that unit makes.
    // when: an extra test on the whole line. scale: false turns off scaling.

    // --- Baking ---
    { id: 'allspice', title: 'Allspice substitutions', match: /\ballspice\b/i,
      base: '1 tsp', name: 'allspice', options: ['[1/2 tsp] cinnamon + [1/8 tsp] ground cloves'] },
    { id: 'arrowroot', title: 'Arrowroot substitutions', match: /\barrowroot\b/i,
      base: '1 tsp', name: 'arrowroot (as a thickener)', options: ['[1 Tbsp] flour', '[1 tsp] cornstarch'] },
    { id: 'baking-powder', title: 'Baking powder substitutions', match: /\bbaking\s+powder\b/i,
      base: '1 tsp', name: 'baking powder', options: ['[1/4 tsp] baking soda + [1/4 tsp] cornstarch + [1/2 tsp] cream of tartar'] },
    { id: 'baking-soda', title: 'Baking soda substitutions', match: /\bbaking\s+soda\b|\bbicarbonate\s+of\s+soda\b|\bbicarb\b/i,
      base: '1 tsp', name: 'baking soda', options: ['[4 tsp] baking powder', '[1 tsp] potassium bicarbonate + [1/3 tsp] salt'] },
    { id: 'bread-crumbs', title: 'Bread crumb substitutions', match: /\bbread\s*crumbs?\b|\bpanko\b/i,
      base: '1 cup', name: 'bread crumbs', options: ['[1 cup] cracker crumbs', '[1 cup] matzo meal', '[1 cup] ground oats'] },
    { id: 'cracker-crumbs', title: 'Cracker crumb substitutions', match: /\bcracker\s+crumbs?\b/i, exclude: /\bgraham\s+cracker\s+crumbs?\b/gi,
      base: '3/4 cup', name: 'cracker crumbs', options: ['[1 cup] dry bread crumbs', '[1 Tbsp] quick-cooking oats (for thickening)'] },
    { id: 'flour', title: 'All-purpose flour substitutions', match: /\b(?:all[-\s]purpose\s+|plain\s+|white\s+)?flour\b/i,
      exclude: /\b(?:cake|pastry|self[-\s]ris(?:ing|en)|self[-\s]raising|bread|whole[-\s]?wheat|wholemeal|almond|coconut|rice|rye|potato|corn|tapioca|oat|chickpea|gram|semolina|buckwheat|spelt|gluten[-\s]free|cassava|sorghum|teff|00|graham|masa|wheat)\s+flour\b|\bcornflour\b|\bflour\s+tortillas?\b/gi,
      base: '1 cup', name: 'all-purpose flour',
      options: [
        '[1 cup] + [3 Tbsp] cake flour (not recommended for cookies or quick breads)',
        "[1 cup] self-rising flour (leave out the recipe's baking powder and salt)",
        '[5/8 cup] potato flour (a reader suggestion)',
        '[1 cup] to [1-1/4 cups] rye flour or coarsely ground whole-grain flour (a reader suggestion)',
        '[1 cup] cornmeal (a reader suggestion)'
      ] },
    { id: 'cake-flour', title: 'Cake flour substitutions', match: /\bcake\s+flour\b/i,
      base: '1 cup', name: 'cake flour', options: ['[1 cup] minus [2 Tbsp] sifted all-purpose flour + [3 Tbsp] cornstarch'] },
    { id: 'self-rising-flour', title: 'Self-rising flour substitutions', match: /\bself[-\s]ris(?:ing|en)\s+flour\b|\bself[-\s]raising\s+flour\b/i,
      base: '1 cup', name: 'self-rising flour', options: ['[1 cup] all-purpose flour + [1-1/2 tsp] baking powder + [1/4 tsp] salt'] },
    { id: 'chocolate', title: 'Unsweetened chocolate substitutions', match: /\bunsweetened\s+(?:baking\s+)?chocolate\b|\bbaking\s+chocolate\b|\bchocolate,?\s+unsweetened\b/i,
      base: '1 oz', name: 'unsweetened chocolate', equiv: { square: 1 },
      options: ['[3 Tbsp] cocoa + [1 Tbsp] unsalted butter, shortening, or vegetable oil'] },
    { id: 'vanilla-bean', title: 'Vanilla bean substitutions', match: /\bvanilla\s+(?:beans?|pods?)\b/i,
      base: '1-inch piece of', name: 'vanilla bean', scale: false, options: ['[1 tsp] vanilla extract'] },
    { id: 'vanilla', title: 'Vanilla extract substitutions', match: /\bvanilla\b/i,
      exclude: /\bvanilla\s+(?:beans?|pods?|ice\s+cream|yogh?urt|pudding|sugar|wafers?|frosting|bean\s+paste)\b/gi,
      base: '1 tsp', name: 'vanilla extract', options: ['[2 tsp] bourbon, rum, or whiskey (twice the amount of vanilla)'] },
    { id: 'yeast', title: 'Yeast substitutions', match: /\byeast\b/i, exclude: /\bnutritional\s+yeast\b|\byeast\s+extract\b/gi,
      base: '1 cake (3/5 oz)', name: 'compressed (cake) yeast', equiv: { oz: 1 / 0.6 },
      options: ['[1|package (1/4 oz) active dry yeast|packages (1/4 oz each) active dry yeast]', 'a scant [1 Tbsp] active dry yeast'] },

    // --- Sugars and sweeteners ---
    { id: 'sugar', title: 'Granulated sugar substitutions', match: /\b(?:granulated\s+|white\s+|cane\s+)?sugar\b/i,
      exclude: /\b(?:brown|powdered|confectioners'?|icing|palm|coconut|maple|turbinado|demerara|raw|cinnamon|vanilla|pearl|sanding|coarse|decorating|superfine|caster)\s+sugar\b|\bsugar[-\s](?:free|snap|substitute)\b|\bsugar\s+snap\b/gi,
      base: '1 cup', name: 'granulated sugar',
      options: ['[1 cup] firmly packed brown sugar', "[1-3/4 cups] confectioners' sugar (baked goods will be less crisp)", '[1 cup] superfine sugar'] },
    { id: 'brown-sugar', title: 'Brown sugar substitutions', match: /\b(?:light\s+|golden\s+)?brown\s+sugar\b/i, exclude: /\bdark\s+brown\s+sugar\b/gi,
      base: '1 cup', name: 'brown sugar',
      options: ['[1 Tbsp] molasses + enough granulated sugar to make [1 cup]', '[1 cup] granulated sugar + [1 Tbsp] to [2 Tbsp] molasses', '[1/2 cup] dark brown sugar + [1/2 cup] granulated sugar'] },
    { id: 'dark-brown-sugar', title: 'Dark brown sugar substitutions', match: /\bdark\s+brown\s+sugar\b/i,
      base: '1 cup', name: 'dark brown sugar', options: ['[1 cup] packed light brown sugar', '[1 cup] granulated sugar + [2 Tbsp] to [3 Tbsp] molasses'] },
    { id: 'palm-sugar', title: 'Palm sugar substitutions', match: /\bpalm\s+sugar\b|\bjaggery\b/i,
      name: 'palm sugar', options: ['Light brown sugar'] },
    { id: 'honey', title: 'Honey substitutions', match: /\bhoney\b/i, exclude: /\bhoney\s+mustard\b/gi,
      base: '1 cup', name: 'honey', options: ['[1-1/4 cups] sugar + [1/2 cup] liquid called for in the recipe (such as water or oil)', '[1 cup] pure maple syrup'] },
    { id: 'molasses', title: 'Molasses substitutions', match: /\bmolasses\b/i, exclude: /\bpomegranate\s+molasses\b/gi,
      base: '1 cup', name: 'molasses', options: ['[1 cup] honey or dark corn syrup'] },
    { id: 'sweetened-condensed-milk', title: 'Sweetened condensed milk substitutions', match: /\b(?:sweetened\s+)?condensed\s+milk\b/i,
      base: '1 can (14 oz)', name: 'sweetened condensed milk', equiv: { oz: 1 / 14 },
      options: ['[1 cup] evaporated milk + [1-1/4 cups] granulated sugar; heat and stir until the sugar dissolves'] },

    // --- Dairy and eggs ---
    { id: 'butter', title: 'Butter substitutions', match: /\bbutter\b/i,
      exclude: /\b(?:peanut|almond|cashew|nut|seed|sunflower|apple|pumpkin|cocoa|shea|sun|cookie)\s+butter\b|\bbutter\s+(?:beans?|lettuce|extract|flavou?r(?:ed|ing)?)\b/gi,
      base: '1 cup', name: 'butter', equiv: { stick: 0.5, lb: 2, oz: 1 / 8 },
      options: ['[1 cup] margarine', '[1 cup] shortening (add [1/2 tsp] salt if the recipe uses salted butter)', '[7/8 cup] vegetable oil (add [1/2 tsp] salt if the recipe uses salted butter)'] },
    { id: 'buttermilk', title: 'Buttermilk substitutions', match: /\bbuttermilk\b/i,
      base: '1 cup', name: 'buttermilk', options: ['[1 Tbsp] lemon juice or vinegar + enough milk to make [1 cup]', '[1 cup] plain yogurt'] },
    { id: 'heavy-cream', title: 'Heavy and whipping cream substitutions', match: /\bcream\b/i,
      exclude: /\b(?:sour|ice|light|single|coffee|table|coconut|clotted)\s+cream\b|\bcream\s+(?:cheese|of\s+\w+|soda|sherry|style|puffs?)\b|\bcr[eè]me\s+fra[iî]che\b/gi,
      base: '1 cup', name: 'heavy or whipping cream',
      options: ["For cooking: [3/4 cup] milk + [1/3 cup] melted butter (this won't whip)", 'For whipping: [2/3 cup] well-chilled evaporated milk, whipped', 'For whipping: [1 cup] nonfat dry milk powder whipped with [1 cup] ice water'] },
    { id: 'light-cream', title: 'Light cream substitutions', match: /\b(?:light|single|coffee|table)\s+cream\b/i,
      base: '1 cup', name: 'light cream', options: ['[7/8 cup] milk + [3 Tbsp] melted unsalted butter'] },
    { id: 'sour-cream', title: 'Sour cream substitutions', match: /\bsour\s+cream\b/i,
      base: '1 cup', name: 'sour cream', options: ['[7/8 cup] buttermilk or plain yogurt + [3 Tbsp] melted unsalted butter'] },
    { id: 'egg', title: 'Egg substitutions', match: /\beggs?\b/i,
      exclude: /\beggs?\s+(?:whites?|yolks?|noodles?|rolls?|substitute)\b|\b(?:whites?|yolks?)\s+(?:of|from)\s+(?:\d+\s+)?(?:large\s+)?eggs?\b/gi,
      base: '1 egg', name: '(about 3 Tbsp)',
      options: [
        '[2|egg yolk|egg yolks] + [1 Tbsp] cold water',
        '[3 Tbsp] vegetable oil + [1 Tbsp] water (for baking)',
        '[3 Tbsp] mayonnaise (for cakes)',
        '[2-1/2 Tbsp] powdered egg substitute + [2-1/2 Tbsp] water',
        '[1/4 cup] liquid egg substitute',
        '[1/2|mashed banana|mashed bananas] + [1/2 tsp] baking powder',
        '[1 Tbsp] ground flaxseed + [3 Tbsp] warm water, for muffins and quick breads (a reader suggestion)'
      ] },
    { id: 'egg-white', title: 'Egg white substitutions', match: /\begg\s+whites?\b|\bwhites?\s+(?:of|from)\s+(?:\d+\s+)?(?:large\s+)?eggs?\b/i,
      base: '1 egg white', name: '', options: ['[2 Tbsp] meringue powder + [3 Tbsp] water'] },
    { id: 'skim-milk', title: 'Skim milk substitutions', match: /\b(?:skim|skimmed|nonfat|non-fat|fat[-\s]free)\s+milk\b/i,
      base: '1 cup', name: 'skim milk', options: ['[1/3 cup] instant nonfat dry milk + [3/4 cup] water'] },
    { id: 'sour-milk', title: 'Sour milk substitutions', match: /\bsour(?:ed)?\s+milk\b/i,
      base: '1 cup', name: 'sour milk', options: ['[1 Tbsp] vinegar or lemon juice + enough milk to make [1 cup]; stir and let stand 5 minutes'] },
    { id: 'milk', title: 'Whole milk substitutions', match: /\bmilk\b/i,
      exclude: /\b(?:skim|skimmed|nonfat|non-fat|fat[-\s]free|sour(?:ed)?|coconut|almond|soy|oat|rice|cashew|evaporated|condensed|dry|powdered|malted|goat'?s?|chocolate)\s+milk\b|\bmilk\s+(?:chocolate|powder|solids)\b/gi,
      base: '1 cup', name: 'whole milk', options: ['[1/2 cup] evaporated milk + [1/2 cup] water', '[3/4 cup] 2% milk + [1/4 cup] half-and-half'] },
    { id: 'yogurt', title: 'Plain yogurt substitutions', match: /\byogh?urt\b/i, exclude: /\bfrozen\s+yogh?urt\b|\bvanilla\s+yogh?urt\b/gi,
      base: '1 cup', name: 'plain yogurt', options: ['[1 cup] sour cream (thicker and less tart)', '[1 cup] buttermilk (thinner; for baking, dressings, and sauces)'] },
    { id: 'mayonnaise', title: 'Mayonnaise substitutions', match: /\bmayonnaise\b|\bmayo\b/i,
      base: '1 cup', name: 'mayonnaise', options: ['[1 cup] sour cream or plain yogurt', '[1 cup] puréed cottage cheese'] },
    { id: 'mascarpone', title: 'Mascarpone substitutions', match: /\bmascarpone\b/i,
      base: '1 cup', name: 'mascarpone', options: ['[3 Tbsp] heavy cream + [3/4 cup] cream cheese + [4 Tbsp] butter'] },
    { id: 'neufchatel', title: 'Neufchâtel substitutions', match: /\bneufch[aâ]tel\b/i,
      name: 'Neufchâtel', options: ['Cream cheese or Boursin'] },
    { id: 'romano', title: 'Romano substitutions', match: /\bromano\b/i,
      name: 'Romano cheese', options: ['Parmesan cheese'] },

    // --- Fats, grains and crumbs ---
    { id: 'oil', title: 'Oil substitutions (baking)', match: /\b(?:vegetable|canola|corn|sunflower|safflower|neutral|grapeseed)\s+oil\b/i,
      when: line => !/\bfry|frying|greasing|spray|brushing\b/i.test(line),
      base: '1/2 cup', name: 'oil in baking', options: ['[1/2 cup] applesauce (keeps baked goods moist with less fat)'] },
    { id: 'oat-bran', title: 'Oat bran substitutions', match: /\boat\s+bran\b/i,
      base: '1 cup', name: 'oat bran', options: ['[1 cup] wheat bran, rice bran, or wheat germ'] },
    { id: 'oats', title: 'Old-fashioned oat substitutions', match: /\b(?:old[-\s]fashioned|rolled)\s+oats\b/i,
      base: '1 cup', name: 'old-fashioned oats', options: ['[1 cup] steel-cut Irish or Scotch oats'] },
    { id: 'quinoa', title: 'Quinoa substitutions', match: /\bquinoa\b/i,
      base: '1 cup', name: 'quinoa', options: ['[1 cup] millet, couscous (whole-wheat couscous cooks faster), or bulgur'] },
    { id: 'lo-mein', title: 'Lo mein noodle substitutions', match: /\blo\s+mein\b/i,
      name: 'lo mein noodles', options: ['Egg noodles'] },

    // --- Herbs, spices and seasonings ---
    { id: 'garlic', title: 'Garlic substitutions', match: /\bgarlic\b/i,
      exclude: /\bgarlic\s+(?:powder|salt|granules|chives|bread|press)\b|\bgranulated\s+garlic\b|\bblack\s+garlic\b/gi,
      base: '1 small clove', name: 'garlic', options: ['[1/8 tsp] garlic powder', '[1/8 tsp] dried minced garlic'] },
    { id: 'herbs-dried', title: 'Dried herb substitutions', match: HERB, exclude: HERB_EXCLUDE, when: looksDried,
      base: '1 tsp', name: 'dried herbs', options: ['[1 Tbsp] to [2 Tbsp] fresh herbs, minced and packed'],
      note: "The Almanac's rule: 1/2 to 1 teaspoon dried herbs = 1 tablespoon fresh herbs, minced and packed." },
    { id: 'herbs-fresh', title: 'Fresh herb substitutions', match: HERB, exclude: HERB_EXCLUDE, when: line => !looksDried(line),
      base: '1 Tbsp', name: 'fresh herbs, minced and packed', options: ['[1/2 tsp] to [1 tsp] dried herbs'] },
    { id: 'cilantro', title: 'Cilantro substitutions', match: /\bcilantro\b|\bfresh\s+coriander\b|\bcoriander\s+leaves\b/i,
      name: 'cilantro', options: ["Parsley — for color only; the flavor can't be matched"] },
    { id: 'bergamot', title: 'Bergamot substitutions', match: /\bbergamot\b/i, name: 'bergamot', options: ['Mint'] },
    { id: 'italian-seasoning', title: 'Italian seasoning substitutions', match: /\bitalian\s+(?:seasoning|herbs)\b/i,
      name: 'Italian seasoning', options: ['Equal parts basil, marjoram, oregano, rosemary, sage, and thyme'] },
    { id: 'lemongrass', title: 'Lemongrass substitutions', match: /\blemon\s?grass\b/i,
      base: '2 stalks', name: 'lemongrass', options: ['Grated zest of [1|lemon|lemons]'] },
    { id: 'saffron', title: 'Saffron substitutions', match: /\bsaffron\b/i,
      name: 'saffron', options: ['Turmeric — for color only; the flavor is different'] },
    { id: 'dry-mustard', title: 'Dry mustard substitutions', match: /\b(?:dry|dried|ground|powdered)\s+mustard\b|\bmustard\s+powder\b/i,
      base: '1 tsp', name: 'dry mustard', options: ['[1 Tbsp] prepared mustard, and use [1 tsp] less liquid in the recipe'] },

    // --- Lemons and limes ---
    { id: 'lemon', title: 'Lemon substitutions',
      match: /\b(?:zest|rind|peel)\s+and\s+juice\s+of\s+(?:\d+\s+|an?\s+|one\s+)?lemons?\b|\bjuice\s+and\s+(?:zest|rind|peel)\s+of\s+(?:\d+\s+|an?\s+|one\s+)?lemons?\b|\blemons?\b/i,
      exclude: /\blemon\s+(?:extract|pepper|curd|zest|rind|peel|juice|wedges?|slices?|oil|verbena|cake|grass)\b|\blemon[-\s]lime\b/gi,
      base: '1 lemon', name: '(juice and grated rind)', options: ['[3 Tbsp] bottled lemon juice + [1 tsp] dried grated lemon rind'] },
    { id: 'lemon-juice', title: 'Lemon juice substitutions',
      match: /\blemon\s+juice\b|\bjuice\s+(?:of|from)\s+(?:\d+\s+|an?\s+|one\s+|half\s+(?:of\s+)?an?\s+|\d\/\d\s+)?lemons?\b/i,
      base: '1 tsp', name: 'lemon juice', options: ['[1/2 tsp] vinegar'] },
    { id: 'lemon-rind', title: 'Lemon rind substitutions',
      match: /\blemon\s+(?:zest|rind|peel)\b|\b(?:zest|rind|peel)\s+(?:of|from)\s+(?:\d+\s+|an?\s+|one\s+|half\s+(?:of\s+)?an?\s+)?lemons?\b|\bgrated\s+lemon\b/i,
      base: '1 tsp', name: 'grated lemon rind', options: ['[1/2 tsp] lemon extract'] },
    { id: 'lime', title: 'Lime substitutions', match: /\blimes?\b/i,
      exclude: /\bkey\s+lime\s+pie\b|\blemon[-\s]lime\b|\b(?:kaffir|makrut)\s+lime\b|\blime\s+leaves\b/gi,
      name: 'limes or lime juice', options: ['Lemons or lemon juice'] },

    // --- Tomatoes and sauces ---
    { id: 'ketchup', title: 'Ketchup substitutions', match: /\bketchup\b|\bcatsup\b/i,
      base: '1 cup', name: 'ketchup',
      options: [
        '[1 cup] tomato sauce + [1/4 cup] sugar + [3 Tbsp] apple cider vinegar + [1/2 tsp] salt + a pinch of ground cloves',
        '[1 cup] tomato sauce + [1/4 cup] sugar + [2 Tbsp] vinegar + [1/4 tsp] ground cloves',
        '[1 cup] chili sauce'
      ] },
    { id: 'tomato-juice', title: 'Tomato juice substitutions', match: /\btomato\s+juice\b/i,
      base: '1 cup', name: 'tomato juice',
      options: ['[1/2 cup] tomato sauce + [1/2 cup] water + a dash each of salt and sugar', '[1/4 cup] tomato paste + [3/4 cup] water + salt and sugar to taste'] },
    { id: 'tomato-puree', title: 'Tomato purée substitutions', match: /\btomato\s+pur[eé]e\b|\bpassata\b/i,
      base: '1 cup', name: 'tomato purée', options: ['[1/2 cup] tomato paste + [1/2 cup] water'] },
    { id: 'tomato-soup', title: 'Tomato soup substitutions', match: /\btomato\s+soup\b/i,
      base: '1 can (10-3/4 oz)', name: 'condensed tomato soup', equiv: { oz: 1 / 10.75 },
      options: ['[1 cup] tomato sauce + [1/4 cup] water'] },
    { id: 'canned-tomatoes', title: 'Canned tomato substitutions',
      match: /\b(?:canned|tinned|diced|crushed|stewed|whole\s+peeled|peeled)\s+tomatoes\b|\bcans?\s+(?:of\s+)?(?:diced\s+|crushed\s+|whole\s+)?tomatoes\b/i,
      base: '1 cup', name: 'canned tomatoes', options: ['[1/2 cup] tomato sauce + [1/2 cup] water', '[1-1/3 cups] chopped fresh tomatoes, simmered'] },
    { id: 'tamarind', title: 'Tamarind substitutions', match: /\btamarind\b/i,
      name: 'tamarind juice', options: ['5 parts ketchup to 1 part vinegar'] },
    { id: 'shrimp-paste', title: 'Shrimp paste substitutions', match: /\bshrimp\s+paste\b|\bbelacan\b/i,
      name: 'shrimp paste', options: ['Anchovy paste'] },
    { id: 'coconut-milk', title: 'Coconut milk substitutions', match: /\bcoconut\s+milk\b/i,
      base: '2 cups', name: 'coconut milk',
      options: ['[2-1/2 cups] water + [2 cups] shredded unsweetened coconut: bring to a boil, take off the heat, let cool, blend for 2 minutes, then strain'] },

    // --- Vinegars and wine ---
    { id: 'vinegar', title: 'Vinegar substitutions', match: /\bvinegar\b/i,
      exclude: /\b(?:apple[-\s]cider|cider|balsamic|red[-\s]wine|white[-\s]wine|rice(?:\s+wine)?)\s+vinegar\b/gi,
      base: '1 tsp', name: 'vinegar', options: ['[1 tsp] lemon or lime juice', '[2 tsp] white wine'] },
    { id: 'cider-vinegar', title: 'Apple cider vinegar substitutions', match: /\b(?:apple[-\s])?cider\s+vinegar\b/i,
      name: 'apple cider vinegar', options: ['Malt, white-wine, or rice vinegar'] },
    { id: 'balsamic', title: 'Balsamic vinegar substitutions', match: /\bbalsamic\b/i,
      base: '1 Tbsp', name: 'balsamic vinegar', options: ['[1 Tbsp] red- or white-wine vinegar + [1/2 tsp] sugar'] },
    { id: 'red-wine-vinegar', title: 'Red-wine vinegar substitutions', match: /\bred[-\s]wine\s+vinegar\b/i,
      name: 'red-wine vinegar', options: ['White-wine, sherry, champagne, or balsamic vinegar'] },
    { id: 'white-wine-vinegar', title: 'White-wine vinegar substitutions', match: /\bwhite[-\s]wine\s+vinegar\b/i,
      name: 'white-wine vinegar', options: ['Apple-cider, champagne, fruit (such as raspberry), rice, or red-wine vinegar'] },
    { id: 'rice-vinegar', title: 'Rice vinegar substitutions', match: /\brice(?:\s+wine)?\s+vinegar\b/i,
      name: 'rice vinegar', options: ['Apple-cider, champagne, or white-wine vinegar'] },
    { id: 'wine', title: 'Wine substitutions', match: /\bwine\b/i, exclude: /\bwine\s+vinegar\b|\brice\s+wine\b/gi,
      base: '1 cup', name: 'wine', options: ['[1 cup] chicken or beef broth', '[1 cup] fruit juice mixed with [2 tsp] vinegar', '[1 cup] water'] },
    { id: 'rice-wine', title: 'Rice wine substitutions', match: /\brice\s+wine\b|\bshaoxing\b/i, exclude: /\brice\s+wine\s+vinegar\b/gi,
      name: 'rice wine', options: ['Pale, dry sherry or white vermouth'] },

    // --- Vegetables and fruit ---
    { id: 'shallot', title: 'Shallot substitutions', match: /\bshallots?\b/i,
      name: 'shallots', options: ['Red or Spanish onions'] },
    { id: 'red-pepper', title: 'Red pepper substitutions', match: /\b(?:roasted\s+)?red\s+(?:bell\s+)?peppers?\b/i,
      exclude: /\bred\s+pepper\s+(?:flakes|powder|sauce|paste)\b|\b(?:crushed|ground|hot)\s+red\s+peppers?\b/gi,
      name: 'red peppers', options: ['The same amount of pimientos'] },
    { id: 'habanero', title: 'Habanero substitutions', match: /\bhabaneros?\b/i,
      name: 'habanero peppers', options: ['5 jalapeño or serrano peppers'] },
    { id: 'bamboo-shoots', title: 'Bamboo shoot substitutions', match: /\bbamboo\s+shoots?\b/i,
      name: 'bamboo shoots', options: ['Asparagus (in fried dishes)'] },
    { id: 'chayote', title: 'Chayote substitutions', match: /\bchayotes?\b/i,
      name: 'chayote', options: ['Yellow summer squash or zucchini'] },
    { id: 'delicata', title: 'Delicata squash substitutions', match: /\bdelicata\b/i,
      name: 'delicata squash', options: ['Butternut squash or sweet potato'] },
    { id: 'green-mango', title: 'Green mango substitutions', match: /\b(?:green|unripe)\s+mango(?:e?s)?\b/i,
      name: 'green mangoes', options: ['Sour, green cooking apples'] }
  ].map(c => (c.options && !c.source ? { ...c, source: ALMANAC } : c));

  // ---------- Amount parsing ----------

  const UNICODE_FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  const NUMBER = '(?:\\d+\\s*-\\s*)?(?:\\d+\\s+)?(?:\\d+\\/\\d+|\\d*\\.?\\d+|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\\s*[¼½¾⅓⅔⅛⅜⅝⅞])?';
  const UNITS = [
    [/^(?:cups?|c\.?)$/i, 'cup'],
    [/^(?:tablespoons?|tbsps?\.?|tbs\.?|tbl\.?|T)$/, 'tbsp'],
    [/^(?:tablespoons?|tbsps?\.?|tbs\.?|tbl\.?)$/i, 'tbsp'],
    [/^(?:teaspoons?|tsps?\.?|t)$/, 'tsp'],
    [/^(?:teaspoons?|tsps?\.?)$/i, 'tsp']
  ];
  // Units beyond cups and spoons, used to scale option lists. A word that isn't a unit ("2 large eggs")
  // counts whole items.
  const MORE_UNITS = [
    [/^(?:ounces?|oz\.?)$/i, 'oz'], [/^(?:pounds?|lbs?\.?)$/i, 'lb'], [/^sticks?$/i, 'stick'],
    [/^(?:cans?|tins?)$/i, 'can'], [/^(?:packages?|packets?|pkgs?\.?|envelopes?|sachets?)$/i, 'package'],
    [/^squares?$/i, 'square'], [/^cakes?$/i, 'cake'], [/^(?:cloves?|stalks?)$/i, 'each'],
    [/^(?:heads?|bunch(?:es)?|sprigs?|pinch(?:es)?|dash(?:es)?|slices?|pieces?|handfuls?|jars?|bottles?|containers?|quarts?|pints?|liters?|litres?|ml|g|grams?|kg)$/i, 'other']
  ];
  const VOLUME_TSP = { tsp: 1, tbsp: 3, cup: 48 };
  const WEIGHT_OZ = { oz: 1, lb: 16 };

  function parseNumber(text) {
    let s = String(text).trim();
    for (const [ch, v] of Object.entries(UNICODE_FRACTIONS)) s = s.replace(ch, ' ' + v + ' ');
    s = s.replace(/(\d)\s*-\s*(?=\d+\/\d+)/, '$1 ').replace(/\s+/g, ' ').trim();
    let total = 0;
    for (const part of s.split(' ')) {
      if (/^\d+\/\d+$/.test(part)) { const [a, b] = part.split('/').map(Number); if (!b) return NaN; total += a / b; }
      else if (/^\d*\.?\d+$/.test(part)) total += Number(part);
      else return NaN;
    }
    return total;
  }

  // "1/2 cup chopped onion" -> {value: 0.5, unit: 'cup'}; returns null when there is no amount + unit.
  function parseAmount(text) {
    const plain = String(text).replace(/[*_`]/g, '').trim();
    const m = plain.match(new RegExp('^(' + NUMBER + ')\\s*([A-Za-z.]+)'));
    if (!m) return null;
    const value = parseNumber(m[1]);
    const unit = (UNITS.find(([re]) => re.test(m[2])) || [])[1];
    return Number.isFinite(value) && unit ? { value, unit } : null;
  }

  // Like parseAmount, but also understands ounces, sticks, cans and plain counts ("2 large eggs").
  // "1 (14 oz) can milk" -> {value: 1, unit: 'can', text: '1 can'}.
  function parseQuantity(text) {
    const plain = String(text).replace(/[*_`]/g, '').replace(/^[\s\-•·]+/, '').trim();
    const m = plain.match(new RegExp('^(' + NUMBER + ')(?![\\d/])\\s*(?:\\([^)]*\\)\\s*)?([A-Za-z.]+)?'));
    if (!m) return null;
    const value = parseNumber(m[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    const word = (m[2] || '').replace(/\.$/, '');
    const unit = (UNITS.find(([re]) => re.test(word)) || MORE_UNITS.find(([re]) => re.test(word)) || [])[1] || 'each';
    const shown = unit === 'each' || !word ? m[1].trim() : m[1].trim() + ' ' + word;
    return { value, unit, text: shown };
  }

  function sameAmount(a, b) { return a && b && a.unit === b.unit && Math.abs(a.value - b.value) < 0.01; }

  // How many times the entry's base amount the recipe's amount is, or null when they can't be compared.
  function scaleFactor(q, base, equiv) {
    if (!q || !base) return null;
    if (q.unit in VOLUME_TSP && base.unit in VOLUME_TSP) return (q.value * VOLUME_TSP[q.unit]) / (base.value * VOLUME_TSP[base.unit]);
    if (q.unit in WEIGHT_OZ && base.unit in WEIGHT_OZ) return (q.value * WEIGHT_OZ[q.unit]) / (base.value * WEIGHT_OZ[base.unit]);
    if (q.unit === base.unit && q.unit !== 'other') return q.value / base.value;
    if (equiv && equiv[q.unit]) return (q.value * equiv[q.unit]) / base.value;
    return null;
  }

  // ---------- Amount formatting ----------

  // 1.5 -> {text: '1-1/2', err}; the nearest whole number plus a fraction with one of the given denominators.
  function fraction(x, dens = [2, 3, 4, 8]) {
    let best = { text: String(Math.round(x)), value: Math.round(x) };
    for (const d of dens) {
      const n = Math.round(x * d);
      const v = n / d;
      if (Math.abs(v - x) < Math.abs(best.value - x) - 1e-9) {
        const whole = Math.floor(n / d), rest = n % d;
        let text;
        if (!rest) text = String(whole);
        else {
          const g = gcd(rest, d);
          text = (whole ? whole + '-' : '') + rest / g + '/' + d / g;
        }
        best = { text, value: v };
      }
    }
    return { text: best.text, value: best.value, err: x ? Math.abs(best.value - x) / x : 0 };
  }
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  // A volume in teaspoons, written the way a cook would measure it.
  // Under 1/4 cup it uses spoons; from 1/4 cup, cups in quarters or thirds, or spoons under 1/2 cup;
  // otherwise cups plus spoons ("1/4 cup + 3 Tbsp" is how it gets measured anyway).
  function formatVolume(tsp) {
    if (tsp < 0.1) return { text: 'a pinch of', err: 0 };
    if (tsp < 2.99) { const f = fraction(tsp); return { text: f.text + ' tsp', err: f.err }; }
    const cups = tsp / 48;
    const word = c => (c > 1 + 1e-9 ? ' cups' : ' cup');
    if (tsp >= 11.99) {
      const f = fraction(cups, [2, 3, 4]);
      if (f.err < 0.01) return { text: f.text + word(f.value), err: f.err };
    }
    if (tsp < 23.99) {
      const f = fraction(tsp / 3, [2]);
      if (f.err < 0.02) return { text: f.text + ' Tbsp', err: f.err };
      const whole = Math.floor(tsp / 3 + 1e-9);
      const rest = fraction(tsp - whole * 3);
      if (rest.value === 0) return { text: whole + ' Tbsp', err: Math.abs(whole * 3 - tsp) / tsp };
      return { text: whole + ' Tbsp + ' + rest.text + ' tsp', err: Math.abs(whole * 3 + rest.value - tsp) / tsp };
    }
    const quarters = Math.floor(cups * 4 + 1e-9) / 4;
    const restTsp = tsp - quarters * 48;
    const q = fraction(quarters, [4]);
    if (restTsp < 0.1) return { text: q.text + word(quarters), err: restTsp / tsp };
    const rest = formatVolume(restTsp);
    return { text: q.text + word(quarters) + ' + ' + rest.text, err: rest.err * restTsp / tsp };
  }

  function formatScaled(q, factor) {
    if (q.unit in VOLUME_TSP) return formatVolume(q.value * VOLUME_TSP[q.unit] * factor);
    const f = fraction(q.value * factor, [2, 3, 4]);
    if (q.unit === 'each') return f;
    return { text: f.text + ' ' + (q.unit === 'oz' ? 'oz' : q.unit), err: f.err };
  }

  // Splits an option into text and amounts, scaling the [bracketed] amounts by `factor` (null = as written).
  function renderOption(option, factor) {
    const parts = [];
    let last = 0;
    String(option).replace(/\[([^\]]+)\]/g, (whole, inner, at) => {
      if (at > last) parts.push({ text: option.slice(last, at) });
      last = at + whole.length;
      const [amount, one, many] = inner.split('|');
      const q = parseQuantity(amount);
      if (!q || factor == null || Math.abs(factor - 1) < 1e-6) {
        const n = q ? q.value : 1;
        parts.push({ amount: one ? amount + ' ' + (n > 1 ? many : one) : amount });
        return whole;
      }
      const scaled = formatScaled(q, factor);
      const n = q.value * factor;
      parts.push({ amount: (scaled.err > 0.05 ? 'about ' : '') + scaled.text + (one ? ' ' + (n > 1 + 1e-9 ? many : one) : '') });
      return whole;
    });
    if (last < option.length) parts.push({ text: option.slice(last) });
    return parts;
  }

  function formatFactor(f) {
    const fr = fraction(f);
    return '×' + (fr.err < 0.01 ? fr.text : String(Math.round(f * 100) / 100));
  }

  // ---------- Matching ----------

  // The entry whose ingredient comes first in the line, ignoring each entry's excluded phrases.
  function chartFor(line) {
    let best = null, bestAt = Infinity;
    for (const c of SUBSTITUTIONS) {
      const text = c.exclude ? line.replace(new RegExp(c.exclude.source, 'gi'), m => ' '.repeat(m.length)) : line;
      const m = c.match.exec(text);
      if (!m || (c.when && !c.when(line))) continue;
      if (m.index < bestAt) { best = c; bestAt = m.index; }
    }
    return best;
  }

  function matchingRow(chart, line) {
    const col = chart.columnOf ? chart.columnOf(line) : 0;
    const amount = parseAmount(line);
    if (!amount) return { col, row: -1 };
    return { col, row: chart.rows.findIndex(r => sameAmount(parseAmount(r[col]), amount)) };
  }

  // ---------- Dialog ----------

  function ensureDialog() {
    let dialog = document.getElementById('subs-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'subs-dialog';
    dialog.setAttribute('aria-labelledby', 'subs-title');
    dialog.innerHTML =
      '<div class="modal"><div class="modalhead"><h2 id="subs-title"></h2>' +
      '<button type="button" class="link" aria-label="Close substitutions">✕</button></div>' +
      '<p class="sub" id="subs-for"></p>' +
      '<div class="subs-table-wrap"><table class="subs-table"><thead><tr></tr></thead><tbody></tbody></table></div>' +
      '<div class="subs-options" hidden><p class="subs-lead"></p><ul></ul></div>' +
      '<p class="sub" id="subs-note"></p><div class="subs-chart-note" id="subs-chart-note" hidden></div>' +
      '<p class="subs-source" hidden></p></div>';
    dialog.querySelector('.modalhead button').onclick = () => dialog.close();
    dialog.addEventListener('click', e => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  }

  function fillTable(dialog, chart, line) {
    const { col, row } = matchingRow(chart, line);
    const head = dialog.querySelector('thead tr');
    head.replaceChildren(...chart.columns.map((name, i) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = name;
      if (i === col) th.className = 'subs-current-col';
      return th;
    }));
    const body = dialog.querySelector('tbody');
    body.replaceChildren(...chart.rows.map((cells, r) => {
      const tr = document.createElement('tr');
      if (r === row) { tr.className = 'subs-match'; tr.setAttribute('aria-current', 'true'); }
      cells.forEach((cell, i) => {
        const td = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) td.scope = 'row';
        td.textContent = cell;
        if (i === col) td.classList.add('subs-current-col');
        tr.append(td);
      });
      return tr;
    }));
    return row >= 0
      ? 'The highlighted row matches the amount in this recipe. Read across it to swap.'
      : 'Each row is the same amount of onion flavor. Find your amount in one column and read across.';
  }

  function fillOptions(dialog, chart, line) {
    const baseText = chart.base ? chart.base + (chart.name ? ' ' + chart.name : '') : '';
    const base = chart.base && chart.scale !== false ? parseQuantity(chart.base) : null;
    const amount = parseQuantity(line);
    const factor = base ? scaleFactor(amount, base, chart.equiv) : null;
    const scaled = factor != null && Math.abs(factor - 1) > 1e-6;
    const many = chart.options.length > 1;
    let lead, note = '';
    if (!chart.base) lead = 'Instead of ' + chart.name + ', use' + (many ? ' one of these:' : ':');
    else if (scaled) {
      lead = 'For the amount in this recipe, use' + (many ? ' one of these:' : ':');
      note = 'Scaled ' + formatFactor(factor) + ' from the amounts for ' + baseText + '.';
    } else {
      lead = 'For ' + baseText + ', use' + (many ? ' one of these:' : ':');
      if (factor == null) note = 'Adjust these amounts to match the amount in your recipe.';
    }
    dialog.querySelector('.subs-lead').textContent = lead;
    dialog.querySelector('.subs-options ul').replaceChildren(...chart.options.map(option => {
      const li = document.createElement('li');
      for (const part of renderOption(option, scaled ? factor : null)) {
        if (part.amount) { const b = document.createElement('b'); b.textContent = part.amount; li.append(b); }
        else li.append(part.text);
      }
      return li;
    }));
    return note;
  }

  function showChart(chart, line) {
    const dialog = ensureDialog();
    const isTable = !!chart.rows;
    dialog.querySelector('#subs-title').textContent = chart.title;
    dialog.querySelector('#subs-for').textContent = 'In this recipe: ' + line;
    dialog.querySelector('.subs-table-wrap').hidden = !isTable;
    dialog.querySelector('.subs-options').hidden = isTable;
    const note = isTable ? fillTable(dialog, chart, line) : fillOptions(dialog, chart, line);
    const noteEl = dialog.querySelector('#subs-note');
    noteEl.textContent = note;
    noteEl.hidden = !note;

    const chartNote = dialog.querySelector('#subs-chart-note');
    const noteLines = [].concat(chart.note || []).filter(Boolean);
    if (noteLines.length > 1) {
      const list = document.createElement('ul');
      list.append(...noteLines.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
      chartNote.replaceChildren(list);
    } else {
      chartNote.textContent = noteLines[0] || '';
    }
    chartNote.hidden = !noteLines.length;

    const source = dialog.querySelector('.subs-source');
    source.hidden = !chart.source;
    if (chart.source) {
      const a = document.createElement('a');
      a.href = chart.source.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = chart.source.name;
      source.replaceChildren('Source: ', a);
    }
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('.modalhead button').focus();
  }

  // Adds "⇄ Swap" buttons to ingredient lines inside `container` (the rendered ingredient list).
  function addSubstitutionHints(container) {
    if (!container) return;
    for (const el of container.querySelectorAll('.ingredient-line, li')) {
      const line = el.textContent.replace(/\s+/g, ' ').trim();
      const chart = chartFor(line);
      if (!chart) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sub-hint';
      button.textContent = '⇄ Swap';
      button.title = chart.title;
      button.setAttribute('aria-label', chart.title + ' for ' + line);
      button.onclick = e => { e.stopPropagation(); showChart(chart, line); };
      el.append(' ', button);
    }
  }

  window.recipeSubstitutions = { SUBSTITUTIONS, addSubstitutionHints, parseAmount, parseQuantity, chartFor, matchingRow, renderOption, scaleFactor, showChart };
})();
