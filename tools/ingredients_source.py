# Quelle für data/ingredients.json – typische Durchschnittswerte (gerundet), eigene Zusammenstellung.
# Werte je 100 g bzw. 100 ml: kcal, Protein, Kohlenhydrate, Fett, Ballaststoffe, Zucker, Salz
# Aufruf: python tools/ingredients_source.py
import json, os
I = []
def add(id, name, cat, basis, n, unit='g', aliases=(), gpp=None, mpp=None, allergens=(), animal=None, pork=False, spice=False, alt=None, group=None):
    kcal, p, c, f, fib, sug, salt = n if n else (None,)*7
    I.append({
        "id": id, "name": name, "aliases": list(aliases), "category": cat,
        **({"shoppingGroup": group} if group else {}),
        "defaultUnit": unit, "nutritionBasis": basis,
        "nutrition": None if not n else {"kcal": kcal, "protein": p, "carbs": c, "fat": f, "fiber": fib, "sugar": sug, "salt": salt},
        **({"gramsPerPiece": gpp} if gpp else {}), **({"mlPerPiece": mpp} if mpp else {}),
        "allergenTags": list(allergens), "animal": animal, "pork": pork, "isSpice": spice,
        "alternatives": alt or {},
    })
FF='Fleisch und Fisch'; VP='vegetarische Proteinquellen'; MP='Milchprodukte'; EP='Ersatzprodukte'; G='Gemüse'; O='Obst'
GT='Getreide'; RN='Reis und Nudeln'; K='Konserven'; TK='Tiefkühlprodukte'; S='Soßen'; OE='Öle und Fette'; GW='Gewürze'; B='Backzutaten'; SO='Sonstiges'
add('haehnchenbrust','Hähnchenbrustfilet',FF,'100g',(110,23,0,1.5,0,0,0.15),aliases=['Hähnchen','Hähnchenbrust','Hühnchen','Hühnerbrust','Hähnchenfilet','Chicken','Chicken breast'],animal='meat')
add('putenbrust','Putenbrustfilet',FF,'100g',(105,24,0,1,0,0,0.12),aliases=['Pute','Putenbrust','Putenfilet','Truthahn'],animal='meat')
add('rinderhack','Rinderhackfleisch (mager)',FF,'100g',(150,21,0,7,0,0,0.15),aliases=['Rinderhack','Hackfleisch','Hack','Beef mince','Minced beef','Ground beef'],animal='meat')
add('kochschinken','Kochschinken',FF,'100g',(110,20,1,3,0,1,2.2),aliases=['Schinken','Ham'],animal='meat',pork=True)
add('lachs','Lachsfilet',FF,'100g',(200,20,0,13,0,0,0.1),aliases=['Lachs','Salmon'],allergens=['fisch'],animal='fish')
add('seelachs','Seelachsfilet (TK)',TK,'100g',(80,18,0,0.9,0,0,0.2),aliases=['Seelachs','Alaska-Seelachs','Fischfilet','White fish','Cod'],allergens=['fisch'],animal='fish')
add('garnelen','Garnelen (TK)',TK,'100g',(70,16,0,1,0,0,0.6),aliases=['Garnele','Shrimps','Prawns','Krabben'],allergens=['schalentiere'],animal='fish')
add('thunfisch','Thunfisch (Dose, im eigenen Saft)',K,'100g',(110,25,0,1,0,0,0.9),aliases=['Thunfisch','Tuna'],allergens=['fisch'],animal='fish')
add('eier','Eier',VP,'100g',(140,12.5,0.7,9.5,0,0.7,0.35),unit='Stück',aliases=['Ei','Eier (Größe M)','Egg','Eggs'],gpp=60,allergens=['eier'],animal='egg',group='Milchprodukte und Ersatzprodukte')
add('tofu','Tofu natur',VP,'100g',(125,13,1.5,7.5,1,0.5,0.02),aliases=['Tofu'],allergens=['soja'])
add('linsen_rot','Rote Linsen (trocken)',VP,'100g',(340,24,50,1.5,11,2,0.03),aliases=['Rote Linsen','Linsen','Red lentils','Lentils'],group='Getreide, Reis und Nudeln')
add('kichererbsen','Kichererbsen (Dose, abgetropft)',K,'100g',(120,7,14,2.5,6,0.5,0.5),aliases=['Kichererbsen','Chickpeas'])
add('kidneybohnen','Kidneybohnen (Dose, abgetropft)',K,'100g',(105,7.5,14,0.5,6.5,0.5,0.6),aliases=['Kidneybohnen','Rote Bohnen','Kidney beans'])
add('huettenkaese','Hüttenkäse',MP,'100g',(100,12,3,4.5,0,3,0.8),aliases=['Körniger Frischkäse','Cottage cheese'],allergens=['milch','laktose'],animal='dairy',alt={'laktose':'huettenkaese_lf'})
add('huettenkaese_lf','Laktosefreier Hüttenkäse',MP,'100g',(100,12,3,4.5,0,3,0.8),aliases=['Hüttenkäse laktosefrei'],allergens=['milch'],animal='dairy')
add('milch','Milch (1,5 % Fett)',MP,'100ml',(47,3.4,4.8,1.5,0,4.8,0.1),unit='ml',aliases=['Milch','Fettarme Milch','Milk'],allergens=['milch','laktose'],animal='dairy',alt={'laktose':'milch_lf'})
add('milch_lf','Laktosefreie Milch (1,5 % Fett)',MP,'100ml',(47,3.4,4.8,1.5,0,4.8,0.1),unit='ml',aliases=['Laktosefreie Milch','Milch laktosefrei'],allergens=['milch'],animal='dairy')
add('skyr','Skyr natur',MP,'100g',(63,11,4,0.2,0,4,0.1),aliases=['Skyr'],allergens=['milch','laktose'],animal='dairy',alt={'laktose':'skyr_lf'})
add('skyr_lf','Laktosefreier Skyr',MP,'100g',(63,11,4,0.2,0,4,0.1),aliases=['Skyr laktosefrei'],allergens=['milch'],animal='dairy')
add('magerquark','Magerquark',MP,'100g',(67,12,4,0.3,0,4,0.1),aliases=['Quark','Speisequark mager'],allergens=['milch','laktose'],animal='dairy',alt={'laktose':'magerquark_lf'})
add('magerquark_lf','Laktosefreier Magerquark',MP,'100g',(67,12,4,0.3,0,4,0.1),aliases=['Magerquark laktosefrei','Quark laktosefrei'],allergens=['milch'],animal='dairy')
add('joghurt','Naturjoghurt (1,5 % Fett)',MP,'100g',(50,3.5,4.5,1.5,0,4.5,0.1),aliases=['Joghurt','Naturjoghurt','Yogurt','Yoghurt'],allergens=['milch','laktose'],animal='dairy',alt={'laktose':'joghurt_lf'})
add('joghurt_lf','Laktosefreier Naturjoghurt',MP,'100g',(50,3.5,4.5,1.5,0,4.5,0.1),aliases=['Joghurt laktosefrei'],allergens=['milch'],animal='dairy')
add('kochsahne','Kochsahne (15 % Fett)',MP,'100ml',(160,3,4,15,0,4,0.1),unit='ml',aliases=['Kochsahne','Sahne','Cream'],allergens=['milch','laktose'],animal='dairy',alt={'laktose':'kochsahne_lf'})
add('kochsahne_lf','Laktosefreie Kochsahne',MP,'100ml',(160,3,4,15,0,4,0.1),unit='ml',aliases=['Kochsahne laktosefrei'],allergens=['milch'],animal='dairy')
add('feta','Feta',MP,'100g',(260,17,0.5,21,0,0.5,3),aliases=['Fetakäse','Schafskäse','Feta cheese'],allergens=['milch','laktose'],animal='dairy')
add('reibekaese','Geriebener Gouda',MP,'100g',(350,25,0,27,0,0,2),aliases=['Reibekäse','Käse','Gouda','Cheese'],allergens=['milch'],animal='dairy')
add('mozzarella','Mozzarella light',MP,'100g',(160,19,1,9,0,1,0.5),aliases=['Mozzarella'],allergens=['milch','laktose'],animal='dairy',alt={'laktose':'mozzarella_lf'})
add('mozzarella_lf','Laktosefreier Mozzarella',MP,'100g',(230,18,1,17,0,1,0.5),aliases=['Mozzarella laktosefrei'],allergens=['milch'],animal='dairy')
add('proteinpulver','Proteinpulver (Whey, neutral)',SO,'100g',(380,75,8,6,0,5,0.5),aliases=['Whey','Eiweißpulver','Proteinpulver'],allergens=['milch','laktose'],animal='dairy',alt={'laktose':'proteinpulver_vegan'})
add('proteinpulver_vegan','Veganes Proteinpulver (Erbse)',SO,'100g',(380,75,5,7,3,1,1),aliases=['Erbsenprotein','Pflanzliches Proteinpulver'])
add('sojadrink','Sojadrink',EP,'100ml',(40,3.3,2.5,1.8,0.5,2.5,0.1),unit='ml',aliases=['Sojamilch','Soy milk'],allergens=['soja'])
add('haferdrink','Haferdrink',EP,'100ml',(45,0.5,7,1.5,0.8,4,0.1),unit='ml',aliases=['Hafermilch','Oat milk'],allergens=['gluten'])
add('paprika','Paprika',G,'100g',(30,1,5,0.3,3.6,4,0),unit='Stück',aliases=['Paprikaschote','Rote Paprika','Bell pepper','Red pepper'],gpp=160)
add('zwiebel','Zwiebel',G,'100g',(40,1.2,8,0.2,1.8,5,0),unit='Stück',aliases=['Zwiebeln','Onion','Onions'],gpp=80)
add('knoblauch','Knoblauchzehe',G,'100g',(140,6,28,0.5,2,1,0.05),unit='Stück',aliases=['Knoblauch','Knoblauchzehen','Garlic','Garlic clove'],gpp=4)
add('brokkoli','Brokkoli',G,'100g',(35,3,3,0.4,3,1.5,0.05),aliases=['Broccoli'])
add('zucchini','Zucchini',G,'100g',(20,1.5,2.5,0.3,1.1,2,0),unit='Stück',aliases=['Courgette'],gpp=250)
add('karotte','Karotte',G,'100g',(40,0.9,8,0.2,3,5,0.1),unit='Stück',aliases=['Möhre','Möhren','Karotten','Carrot','Carrots'],gpp=80)
add('tomate','Tomate',G,'100g',(20,1,3,0.2,1.2,2.6,0),unit='Stück',aliases=['Tomaten','Tomato','Tomatoes'],gpp=100)
add('gurke','Salatgurke',G,'100g',(13,0.6,2,0.1,0.5,1.5,0),aliases=['Gurke','Cucumber'],gpp=400)
add('champignons','Champignons',G,'100g',(22,3,0.5,0.3,2,0.3,0),aliases=['Pilze','Champignon','Mushrooms'])
add('kartoffeln','Kartoffeln',G,'100g',(75,2,15,0.1,2,0.8,0),aliases=['Kartoffel','Potatoes','Potato'])
add('suesskartoffel','Süßkartoffel',G,'100g',(85,1.6,18,0.1,3,4,0.1),aliases=['Süßkartoffeln','Sweet potato'])
add('fruehlingszwiebel','Frühlingszwiebel',G,'100g',(30,1.8,5,0.3,2.5,2,0),unit='Stück',aliases=['Frühlingszwiebeln','Lauchzwiebel','Spring onion','Spring onions'],gpp=15)
add('avocado','Avocado',G,'100g',(160,2,2,15,6.5,0.7,0),unit='Stück',aliases=['Avocados'],gpp=150)
add('spinat','Blattspinat (TK)',TK,'100g',(22,2.6,1,0.4,2.5,0.5,0.1),aliases=['Spinat','Rahmspinat','Spinach'])
add('tk_gemuese','Gemüsemischung (TK)',TK,'100g',(45,2.5,6,0.4,3.5,3,0.05),aliases=['TK-Gemüse','Pfannengemüse','Asia-Gemüse','Mixed vegetables'])
add('erbsen','Erbsen (TK)',TK,'100g',(80,5.5,11,0.5,5.5,4,0),aliases=['Erbsen','Peas'])
add('mais','Mais (Dose, abgetropft)',K,'100g',(85,2.8,15,1.2,3,4,0.5),aliases=['Mais','Sweetcorn','Corn'])
add('tomaten_dose','Gehackte Tomaten (Dose)',K,'100g',(22,1.2,3.5,0.2,1,3,0.1),aliases=['Dosentomaten','Stückige Tomaten','Chopped tomatoes'])
add('passierte_tomaten','Passierte Tomaten',K,'100g',(25,1.3,4,0.2,1,3.5,0.1),aliases=['Passata','Tomatenpüree'])
add('kokosmilch','Kokosmilch (light)',K,'100ml',(75,0.8,2,7,0,1.5,0.05),unit='ml',aliases=['Kokosmilch','Coconut milk'])
add('banane','Banane',O,'100g',(90,1.1,20,0.3,2,17,0),unit='Stück',aliases=['Bananen','Banana'],gpp=120)
add('apfel','Apfel',O,'100g',(52,0.3,12,0.2,2.4,10,0),unit='Stück',aliases=['Äpfel','Apple'],gpp=180)
add('beeren','Beerenmischung (TK)',TK,'100g',(40,0.8,7,0.4,4,6,0),aliases=['Beeren','TK-Beeren','Heidelbeeren','Himbeeren','Berries'])
add('zitronensaft','Zitronensaft',O,'100ml',(25,0.4,7,0.2,0.3,2.5,0),unit='ml',aliases=['Zitrone','Limettensaft','Lemon juice','Lemon'])
add('haferflocken','Haferflocken',GT,'100g',(370,13.5,59,7,10,1,0.02),aliases=['Hafer','Oats','Rolled oats'],allergens=['gluten'])
add('vollkornbrot','Vollkornbrot',GT,'100g',(220,7,40,1.5,7.5,3,1.1),aliases=['Brot','Bread','Wholegrain bread'],gpp=50,allergens=['gluten'],group='Brot und Backwaren')
add('wraps','Weizen-Tortilla-Wraps',GT,'100g',(300,8,50,7,3,3,1.2),unit='Stück',aliases=['Wraps','Tortillas','Tortilla'],gpp=60,allergens=['gluten'],group='Brot und Backwaren')
add('couscous','Couscous (trocken)',GT,'100g',(360,12,72,2,5,1,0.02),aliases=['Couscous'],allergens=['gluten'])
add('reis','Reis (trocken)',RN,'100g',(350,7.5,78,0.6,1.3,0.2,0),aliases=['Basmatireis','Langkornreis','Jasminreis','Rice'])
add('nudeln','Vollkornnudeln (trocken)',RN,'100g',(350,13,64,2.5,9,3,0.02),aliases=['Nudeln','Pasta','Spaghetti','Penne','Vollkornspaghetti'],allergens=['gluten'],alt={'gluten':'nudeln_gf'})
add('nudeln_gf','Glutenfreie Nudeln (trocken)',RN,'100g',(355,7,77,1.5,2,1,0.02),aliases=['Glutenfreie Pasta'])
add('reisnudeln','Reisnudeln (trocken)',RN,'100g',(360,6,80,0.6,1,0,0.05),aliases=['Rice noodles'])
add('mehl','Weizenmehl Type 405',B,'100g',(340,10,71,1,4,0.5,0),aliases=['Mehl','Flour'],allergens=['gluten'])
add('sojasosse','Sojasoße',S,'100ml',(60,8,6,0.1,0.5,1,15),unit='ml',aliases=['Sojasauce','Soy sauce','Sojasosse'],allergens=['soja','gluten'],alt={'gluten':'tamari'})
add('tamari','Tamari (glutenfreie Sojasoße)',S,'100ml',(70,10,6,0.1,0.5,1,15),unit='ml',aliases=['Tamari'],allergens=['soja'])
add('tomatenmark','Tomatenmark',S,'100g',(85,4.5,13,0.5,4,12,0.1),aliases=['Tomato paste','Tomato puree'])
add('senf','Senf (mittelscharf)',S,'100g',(90,6,5,4,2,2,3),aliases=['Senf','Mustard'],allergens=['senf'])
add('gemuesebruehe','Gemüsebrühe (zubereitet)',S,'100ml',(5,0.2,0.6,0.2,0,0.3,0.9),unit='ml',aliases=['Gemüsebrühe','Brühe','Vegetable stock','Stock'],allergens=['sellerie'])
add('erdnussmus','Erdnussmus',SO,'100g',(600,25,12,50,8,5,0.05),aliases=['Erdnussbutter','Peanut butter'],allergens=['erdnuesse'])
add('honig','Honig',SO,'100g',(320,0.4,80,0,0,80,0),aliases=['Honey'],animal='honey')
add('mandeln','Mandeln',SO,'100g',(600,21,6,52,12,4,0),aliases=['Mandel','Almonds'],allergens=['nuesse'])
add('chiasamen','Chiasamen',SO,'100g',(490,17,8,31,34,0,0.02),aliases=['Chia','Chia seeds'])
add('sesam','Sesamsaat',SO,'100g',(570,18,12,50,12,0.5,0),aliases=['Sesam','Sesame seeds'],allergens=['sesam'])
add('olivenoel','Olivenöl',OE,'100ml',(820,0,0,91,0,0,0),unit='ml',aliases=['Olivenöl','Olive oil','Öl'])
add('rapsoel','Rapsöl',OE,'100ml',(820,0,0,91,0,0,0),unit='ml',aliases=['Rapsöl','Pflanzenöl','Sonnenblumenöl','Vegetable oil'])
add('sesamoel','Sesamöl',OE,'100ml',(820,0,0,91,0,0,0),unit='ml',aliases=['Sesame oil'],allergens=['sesam'])
for sid, sname, al, alg in [
    ('salz','Salz',['Speisesalz','Salt'],[]),('pfeffer','Pfeffer',['Schwarzer Pfeffer','Pepper','Black pepper'],[]),
    ('paprikapulver','Paprikapulver',['Paprika edelsüß','Paprika rosenscharf','Paprika powder','Smoked paprika'],[]),
    ('currypulver','Currypulver',['Curry','Curry powder'],['senf','sellerie']),('kreuzkuemmel','Kreuzkümmel',['Cumin'],[]),
    ('oregano','Oregano',[],[]),('chili','Chiliflocken',['Chili','Chilipulver','Chili flakes'],[]),
    ('knoblauchpulver','Knoblauchpulver',['Garlic powder'],[]),('zimt','Zimt',['Cinnamon'],[]),
    ('italienische_kraeuter','Italienische Kräuter',['Kräuter','Pizzagewürz','Mixed herbs'],[]),
    ('ingwer','Ingwerpulver',['Ingwer','Ginger'],[]),('kurkuma','Kurkuma',['Turmeric'],[]),
    ('schnittlauch','Schnittlauch',['Chives'],[]),('petersilie','Petersilie',['Parsley'],[]),
    ('bruehpulver','Gemüsebrühe (Pulver)',['Brühpulver','Gemüsebrühpulver'],['sellerie'])]:
    add(sid, sname, GW, '100g', None, unit='TL', aliases=al, allergens=alg, spice=True)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'ingredients.json')
json.dump(I, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(I))
